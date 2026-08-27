import { describe, expect, test } from "bun:test";
import type { CoachDecision, FrameRequest } from "@wms/shared";
import { CoachEngine, SessionNotFoundError } from "../src/coach/engine.ts";
import type { CoachContext, CoachProvider } from "../src/coach/provider.ts";

class RecordingProvider implements CoachProvider {
  readonly id = "mock" as const;
  contexts: CoachContext[] = [];
  next: CoachDecision = { intervene: false };

  async decide(ctx: CoachContext): Promise<CoachDecision> {
    // 呼び出し時点のスナップショットを保存
    this.contexts.push({
      mode: ctx.mode,
      frames: [...ctx.frames],
      adviceHistory: [...ctx.adviceHistory],
    });
    return this.next;
  }
}

function frameReq(frameIndex: number): FrameRequest {
  return {
    imageBase64: `img${frameIndex}`,
    mediaType: "image/jpeg",
    metrics: { frameIndex, elapsedMs: frameIndex * 1500, changeScore: 0.2, inkRatio: 0.1 },
  };
}

describe("CoachEngine", () => {
  test("未知のセッションはエラー", async () => {
    const engine = new CoachEngine(() => new RecordingProvider());
    await expect(engine.handleFrame("nope", frameReq(0))).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  test("フレームは直近3枚に制限され、古い順で渡される", async () => {
    const provider = new RecordingProvider();
    const engine = new CoachEngine(() => provider);
    const { sessionId } = engine.createSession("drawing");
    for (let i = 0; i < 5; i++) await engine.handleFrame(sessionId, frameReq(i));

    const last = provider.contexts[provider.contexts.length - 1]!;
    expect(last.frames.map((f) => f.imageBase64)).toEqual(["img2", "img3", "img4"]);
  });

  test("介入した指摘だけが履歴に残る", async () => {
    const provider = new RecordingProvider();
    const engine = new CoachEngine(() => provider);
    const { sessionId } = engine.createSession("handwriting");

    await engine.handleFrame(sessionId, frameReq(0)); // silent
    provider.next = { intervene: true, message: "advice1", focus: "position" };
    await engine.handleFrame(sessionId, frameReq(1));
    provider.next = { intervene: false };
    await engine.handleFrame(sessionId, frameReq(2));

    const last = provider.contexts[provider.contexts.length - 1]!;
    expect(last.adviceHistory.length).toBe(1);
    expect(last.adviceHistory[0]!.decision.message).toBe("advice1");
    expect(last.adviceHistory[0]!.frameIndex).toBe(1);
  });

  test("レスポンスにプロバイダとレイテンシが含まれる", async () => {
    const engine = new CoachEngine(() => new RecordingProvider());
    const { sessionId } = engine.createSession("drawing");
    const res = await engine.handleFrame(sessionId, frameReq(0));
    expect(res.provider).toBe("mock");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
