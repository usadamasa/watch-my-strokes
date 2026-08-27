import type { FrameSource } from "./frameSource.ts";

/**
 * カメラなし環境向けのシミュレーション映像ソース。
 * 「紙の上で絵・文字が少しずつ描き進む」様子を Canvas に合成する。
 * わざと崩れ(屋根の非対称、右下がりの行)を含めてあり、コーチが
 * 指摘できる素材になっている。ストローク間には手を止める間(アイドル)が
 * あり、変化検知によるスキップも再現される。
 */

interface StrokeEvent {
  kind: "stroke";
  points: [number, number][];
  t0: number;
  t1: number;
}

interface TextEvent {
  kind: "text";
  char: string;
  x: number;
  y: number;
  size: number;
  rotateDeg: number;
  t0: number;
  t1: number;
}

type SimEvent = StrokeEvent | TextEvent;

/** デザイン座標系(この空間で定義し、描画時にキャンバスへスケール)。 */
const DESIGN_W = 640;
const DESIGN_H = 480;

function stroke(points: [number, number][], t0: number, t1: number): StrokeEvent {
  return { kind: "stroke", points, t0, t1 };
}

/** 家の線画。右壁が開き、屋根の頂点が左に寄っている。 */
function drawingScenario(): SimEvent[] {
  return [
    stroke([[180, 360], [460, 366]], 0, 3000),
    stroke([[184, 362], [176, 230]], 4500, 7000),
    stroke([[458, 364], [488, 236]], 8000, 11000), // 右壁が外へ開いている
    stroke([[178, 232], [484, 238]], 12000, 14500),
    stroke([[172, 234], [290, 130]], 19000, 22000), // 頂点が左寄り
    stroke([[290, 130], [492, 240]], 22500, 25500),
    stroke([[300, 362], [300, 290], [345, 288], [347, 362]], 30000, 34000),
    stroke([[390, 300], [440, 300], [442, 336], [392, 338], [390, 300]], 35000, 39000),
    stroke(circlePoints(105, 105, 38), 43000, 47000),
  ];
}

/** 手書きの行。文字が進むほど右下がり・傾きが増す。 */
function handwritingScenario(): SimEvent[] {
  const chars = ["あ", "め", "の", "ち", "は", "れ"];
  const events: SimEvent[] = [];
  let t = 1000;
  chars.forEach((char, i) => {
    events.push({
      kind: "text",
      char,
      x: 120 + i * 72,
      y: 220 + i * 14, // 右下がり
      size: 64 - i * 2,
      rotateDeg: i * 2.2,
      t0: t,
      t1: t + 3200,
    });
    // 文字間で手が止まる。3文字目の後は長めの休止
    t += i === 2 ? 9000 : 4600;
  });
  return events;
}

function circlePoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function polylineLength(points: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(
      points[i]![0] - points[i - 1]![0],
      points[i]![1] - points[i - 1]![1],
    );
  }
  return len;
}

/** 折れ線を先頭から length ぶんだけ描き、ペン先座標を返す。 */
function drawPartialPolyline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  length: number,
): [number, number] {
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  let remaining = length;
  let tip: [number, number] = points[0]!;
  for (let i = 1; i < points.length && remaining > 0; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg <= remaining) {
      ctx.lineTo(x1, y1);
      tip = [x1, y1];
      remaining -= seg;
    } else {
      const f = remaining / seg;
      tip = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      ctx.lineTo(tip[0], tip[1]);
      remaining = 0;
    }
  }
  ctx.stroke();
  return tip;
}

export class SimulatedSource implements FrameSource {
  readonly label: string;
  private events: SimEvent[];
  readonly durationMs: number;

  constructor(scenario: "drawing" | "handwriting") {
    this.label =
      scenario === "drawing"
        ? "シミュレーション: ドローイング"
        : "シミュレーション: 手書き";
    this.events = scenario === "drawing" ? drawingScenario() : handwritingScenario();
    this.durationMs = Math.max(...this.events.map((e) => e.t1)) + 2000;
  }

  async start(): Promise<void> {}

  stop(): void {}

  render(ctx: CanvasRenderingContext2D, w: number, h: number, tMs: number): void {
    ctx.save();
    ctx.scale(w / DESIGN_W, h / DESIGN_H);

    // 紙
    ctx.fillStyle = "#f7f4ec";
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    ctx.strokeStyle = "#e3ded0";
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, DESIGN_W - 28, DESIGN_H - 28);

    // インク
    ctx.strokeStyle = "#1c2b52";
    ctx.fillStyle = "#1c2b52";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let penTip: [number, number] | null = null;
    for (const event of this.events) {
      if (tMs < event.t0) continue;
      const progress = Math.min(1, (tMs - event.t0) / (event.t1 - event.t0));
      if (event.kind === "stroke") {
        const total = polylineLength(event.points);
        const tip = drawPartialPolyline(ctx, event.points, total * progress);
        if (progress < 1) penTip = tip;
      } else {
        ctx.save();
        ctx.translate(event.x, event.y);
        ctx.rotate((event.rotateDeg * Math.PI) / 180);
        // 左から右へ徐々に現れることで書き進みを表現する
        ctx.beginPath();
        ctx.rect(-8, -event.size, event.size * progress + 8, event.size * 1.4);
        ctx.clip();
        ctx.font = `${event.size}px "Klee One", "Yuji Syuku", serif`;
        ctx.fillText(event.char, 0, 0);
        ctx.restore();
        if (progress < 1) {
          penTip = [event.x + event.size * progress, event.y - event.size * 0.2];
        }
      }
    }

    // ペン先(描いている最中だけ表示)
    if (penTip) {
      ctx.beginPath();
      ctx.arc(penTip[0], penTip[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = "#c94f2e";
      ctx.fill();
    }

    ctx.restore();
  }
}
