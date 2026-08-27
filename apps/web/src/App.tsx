import type { CoachMode, CreateSessionResponse, SessionEvent } from "@wms/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, sendFrame } from "./lib/api.ts";
import {
  gate,
  initialThrottleState,
  markInFlight,
  markSpoke,
  type ThrottleState,
} from "./lib/cooldown.ts";
import { changeScore, inkRatio, toGrayscale } from "./lib/frameDiff.ts";
import { Speaker } from "./lib/tts.ts";
import type { FrameSource, SourceId } from "./sources/frameSource.ts";
import { SimulatedSource } from "./sources/simulated.ts";
import { WebcamSource } from "./sources/webcam.ts";

/** プレビュー解像度。 */
const PREVIEW_W = 640;
const PREVIEW_H = 480;
/** LLMへ送る画像の長辺上限。 */
const SEND_MAX_SIDE = 640;
/** 変化検知・インク率算出用の固定解析解像度(閾値の基準)。 */
const METRICS_W = 192;
const METRICS_H = 144;

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Advice {
  message: string;
  focus?: string;
  atMs: number;
}

/** タイムライン表示用に安定キーを付与したイベント。 */
interface LoggedEvent extends SessionEvent {
  seq: number;
}

function makeSource(id: SourceId): FrameSource {
  if (id === "webcam") return new WebcamSource();
  return new SimulatedSource(id === "sim-drawing" ? "drawing" : "handwriting");
}

function modeFor(id: SourceId, webcamMode: CoachMode): CoachMode {
  if (id === "sim-drawing") return "drawing";
  if (id === "sim-handwriting") return "handwriting";
  return webcamMode;
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function App() {
  const [sourceId, setSourceId] = useState<SourceId>("sim-drawing");
  const [webcamMode, setWebcamMode] = useState<CoachMode>("drawing");
  const [running, setRunning] = useState(false);
  const [intervalMs, setIntervalMs] = useState(1500);
  const [cooldownMs, setCooldownMs] = useState(8000);
  const [minChange, setMinChange] = useState(0.0005);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [dragRect, setDragRect] = useState<CropRect | null>(null);
  const [live, setLive] = useState<{ change: number; ink: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<FrameSource | null>(null);
  const rafRef = useRef(0);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const frameIndexRef = useRef(0);
  const lastSentGrayRef = useRef<Uint8Array | null>(null);
  const throttleRef = useRef<ThrottleState>(initialThrottleState);
  const speakerRef = useRef(new Speaker());
  const eventsRef = useRef<LoggedEvent[]>([]);
  const runningRef = useRef(false);
  const sessionRef = useRef<CreateSessionResponse | null>(null);
  const configRef = useRef({ intervalMs, cooldownMs, minChange });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropRef = useRef<CropRect | null>(null);

  configRef.current = { intervalMs, cooldownMs, minChange };
  cropRef.current = crop;

  const log = useCallback((event: Omit<SessionEvent, "t">) => {
    const entry: LoggedEvent = {
      t: Date.now() - startedAtRef.current,
      seq: eventsRef.current.length,
      ...event,
    };
    eventsRef.current = [...eventsRef.current, entry];
    setEvents(eventsRef.current);
  }, []);

  // シミュレーションハーネス(Playwright)からの観測用フック
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__wms = {
      getEvents: () => eventsRef.current,
      isRunning: () => runningRef.current,
      getSession: () => sessionRef.current,
    };
  }, []);

  const captureTick = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !runningRef.current) return;
    const cfg = configRef.current;
    const frameIndex = frameIndexRef.current++;
    const elapsedMs = Date.now() - startedAtRef.current;

    // クロップ領域(未指定なら全体)を送信用キャンバスへ切り出す
    const region = cropRef.current ?? { x: 0, y: 0, w: 1, h: 1 };
    const sx = region.x * PREVIEW_W;
    const sy = region.y * PREVIEW_H;
    const sw = Math.max(1, region.w * PREVIEW_W);
    const sh = Math.max(1, region.h * PREVIEW_H);
    const scale = Math.min(1, SEND_MAX_SIDE / Math.max(sw, sh));
    const sendCanvas = document.createElement("canvas");
    sendCanvas.width = Math.round(sw * scale);
    sendCanvas.height = Math.round(sh * scale);
    const sendCtx = sendCanvas.getContext("2d")!;
    sendCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sendCanvas.width, sendCanvas.height);

    // 固定解像度の解析キャンバスで指標を算出
    const metricsCanvas = document.createElement("canvas");
    metricsCanvas.width = METRICS_W;
    metricsCanvas.height = METRICS_H;
    const metricsCtx = metricsCanvas.getContext("2d", { willReadFrequently: true })!;
    metricsCtx.drawImage(sendCanvas, 0, 0, METRICS_W, METRICS_H);
    const gray = toGrayscale(metricsCtx.getImageData(0, 0, METRICS_W, METRICS_H).data);
    const ink = inkRatio(gray);
    const change = lastSentGrayRef.current
      ? changeScore(gray, lastSentGrayRef.current)
      : 1;
    setLive({ change, ink });
    const metrics = { frameIndex, elapsedMs, changeScore: change, inkRatio: ink };
    log({ type: "capture", metrics });

    const decision = gate(throttleRef.current, Date.now(), change, {
      minChangeScore: cfg.minChange,
      cooldownMs: cfg.cooldownMs,
    });
    if (decision !== "ask") {
      log({ type: decision, metrics: { frameIndex } });
      return;
    }

    throttleRef.current = markInFlight(throttleRef.current, true);
    log({ type: "ask", metrics: { frameIndex } });
    lastSentGrayRef.current = gray;

    try {
      const dataUrl = sendCanvas.toDataURL("image/jpeg", 0.7);
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const res = await sendFrame(sessionRef.current!.sessionId, {
        imageBase64,
        mediaType: "image/jpeg",
        metrics,
      });
      if (!runningRef.current) return;
      if (res.intervene && res.message) {
        const detail = res.focus ? `[${res.focus}] ${res.message}` : res.message;
        log({ type: "advice", detail, metrics: { frameIndex } });
        setAdvice({
          message: res.message,
          atMs: elapsedMs,
          ...(res.focus ? { focus: res.focus } : {}),
        });
        speakerRef.current.speak(res.message);
        log({ type: "speak", detail: res.message });
        throttleRef.current = markSpoke(throttleRef.current, Date.now());
      } else {
        log({ type: "silent", metrics: { frameIndex } });
        throttleRef.current = markInFlight(throttleRef.current, false);
      }
    } catch (err) {
      log({ type: "error", detail: String(err) });
      throttleRef.current = markInFlight(throttleRef.current, false);
    }
  }, [log]);

  const start = useCallback(async () => {
    setError(null);
    const source = makeSource(sourceId);
    try {
      await source.start();
    } catch (err) {
      setError(`映像ソースを開始できません: ${String(err)}`);
      return;
    }
    let created: CreateSessionResponse;
    try {
      created = await createSession({ mode: modeFor(sourceId, webcamMode) });
    } catch (err) {
      source.stop();
      setError(`セッションを開始できません: ${String(err)}`);
      return;
    }

    sourceRef.current = source;
    sessionRef.current = created;
    setSession(created);
    eventsRef.current = [];
    setEvents([]);
    setAdvice(null);
    frameIndexRef.current = 0;
    lastSentGrayRef.current = null;
    throttleRef.current = initialThrottleState;
    startedAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    log({
      type: "info",
      detail: `開始: ${source.label} / provider=${created.provider}${created.model ? ` (${created.model})` : ""}`,
    });

    const renderLoop = () => {
      const canvas = canvasRef.current;
      const src = sourceRef.current;
      if (canvas && src) {
        const ctx = canvas.getContext("2d")!;
        src.render(ctx, PREVIEW_W, PREVIEW_H, Date.now() - startedAtRef.current);
      }
      if (runningRef.current) rafRef.current = requestAnimationFrame(renderLoop);
    };
    rafRef.current = requestAnimationFrame(renderLoop);
    timerRef.current = window.setInterval(
      () => void captureTick(),
      configRef.current.intervalMs,
    );
  }, [sourceId, webcamMode, captureTick, log]);

  const stop = useCallback(() => {
    if (!runningRef.current && !sourceRef.current) return;
    runningRef.current = false;
    setRunning(false);
    window.clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    sourceRef.current?.stop();
    sourceRef.current = null;
    speakerRef.current.stop();
    log({ type: "info", detail: "停止" });
  }, [log]);

  useEffect(() => () => stop(), [stop]);

  const exportLog = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            session: sessionRef.current,
            config: configRef.current,
            events: eventsRef.current,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wms-session.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  // ---- クロップ選択(プレビュー上のドラッグ) ----
  const toNorm = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = previewWrapRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartRef.current = toNorm(e);
      setDragRect(null);
    },
    [toNorm],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const p = toNorm(e);
      setDragRect({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      });
    },
    [toNorm],
  );

  const onMouseUp = useCallback(() => {
    if (dragRect && dragRect.w > 0.05 && dragRect.h > 0.05) {
      setCrop(dragRect);
      lastSentGrayRef.current = null; // 領域が変わったので差分をリセット
    }
    dragStartRef.current = null;
    setDragRect(null);
  }, [dragRect]);

  const shownRect = dragRect ?? crop;
  const stats = {
    captures: events.filter((e) => e.type === "capture").length,
    skipped: events.filter((e) => e.type.startsWith("skip")).length,
    asked: events.filter((e) => e.type === "ask").length,
    advices: events.filter((e) => e.type === "advice").length,
  };

  return (
    <div className="app">
      <div>
        <h1>watch-my-strokes</h1>
        <div className="subtitle">
          手元の紙をAIコーチが見守り、必要なときだけ短いアドバイスを声で返します
        </div>

        <div className="panel">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウスドラッグ専用のクロップ選択。キーボード操作は「クロップ解除」ボタンで代替 */}
          <div
            className="preview-wrap"
            ref={previewWrapRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} />
            {shownRect && (
              <div
                className="crop-rect"
                style={{
                  left: `${shownRect.x * 100}%`,
                  top: `${shownRect.y * 100}%`,
                  width: `${shownRect.w * 100}%`,
                  height: `${shownRect.h * 100}%`,
                }}
              />
            )}
          </div>

          <div className="controls">
            <select
              data-testid="source-select"
              value={sourceId}
              disabled={running}
              onChange={(e) => setSourceId(e.target.value as SourceId)}
            >
              <option value="sim-drawing">シミュレーション: ドローイング</option>
              <option value="sim-handwriting">シミュレーション: 手書き</option>
              <option value="webcam">Webカメラ</option>
            </select>
            {sourceId === "webcam" && (
              <select
                value={webcamMode}
                disabled={running}
                onChange={(e) => setWebcamMode(e.target.value as CoachMode)}
              >
                <option value="drawing">ドローイング指導</option>
                <option value="handwriting">手書き指導</option>
              </select>
            )}
            {!running ? (
              <button type="button" data-testid="start" onClick={() => void start()}>
                開始
              </button>
            ) : (
              <button
                type="button"
                data-testid="stop"
                className="secondary"
                onClick={stop}
              >
                停止
              </button>
            )}
            {crop && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCrop(null);
                  lastSentGrayRef.current = null;
                }}
              >
                クロップ解除
              </button>
            )}
          </div>

          <div className="controls">
            <label className="field">
              間隔(ms)
              <input
                type="number"
                data-testid="interval"
                value={intervalMs}
                min={500}
                max={5000}
                step={100}
                disabled={running}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
              />
            </label>
            <label className="field">
              クールダウン(ms)
              <input
                type="number"
                data-testid="cooldown"
                value={cooldownMs}
                min={0}
                step={1000}
                disabled={running}
                onChange={(e) => setCooldownMs(Number(e.target.value))}
              />
            </label>
            <label className="field">
              変化閾値
              <input
                type="number"
                value={minChange}
                min={0}
                step={0.0001}
                disabled={running}
                onChange={(e) => setMinChange(Number(e.target.value))}
              />
            </label>
            {live && (
              <span className="badge">
                change {live.change.toFixed(4)} / ink {live.ink.toFixed(4)}
              </span>
            )}
          </div>
          {error && <div style={{ color: "#f57a7a", marginTop: 8 }}>{error}</div>}
        </div>

        <div className="panel advice-panel">
          {advice ? (
            <div className="advice" data-testid="advice">
              <div>
                {advice.focus && <span className="badge focus">{advice.focus}</span>}
                <span className="badge">{fmtSec(advice.atMs)}</span>
              </div>
              <div className="message">{advice.message}</div>
              <div className="meta">
                コーチ: {session?.provider}
                {session?.model ? ` (${session.model})` : ""} — 読み上げ
                {speakerRef.current.supported ? "あり" : "なし(この環境では非対応)"}
              </div>
            </div>
          ) : (
            <div className="advice empty">
              コーチは見守っています。意味のある変化があったときだけ声をかけます。
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="panel">
          <div className="stats" data-testid="stats">
            <span>
              キャプチャ <b>{stats.captures}</b>
            </span>
            <span>
              スキップ <b>{stats.skipped}</b>
            </span>
            <span>
              問い合わせ <b>{stats.asked}</b>
            </span>
            <span>
              アドバイス <b>{stats.advices}</b>
            </span>
          </div>
        </div>
        <div className="panel">
          <div className="controls" style={{ marginTop: 0, marginBottom: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={exportLog}
              disabled={events.length === 0}
            >
              ログをJSONで保存
            </button>
          </div>
          <div className="timeline" data-testid="timeline">
            {[...events].reverse().map((e) => (
              <div className="row" key={e.seq}>
                <span className="t">{fmtSec(e.t)}</span>
                <span className={`type ${e.type}`}>{e.type}</span>
                <span>
                  {e.detail ??
                    (e.metrics?.changeScore !== undefined
                      ? `change=${e.metrics.changeScore.toFixed(4)} ink=${(e.metrics.inkRatio ?? 0).toFixed(4)}`
                      : "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
