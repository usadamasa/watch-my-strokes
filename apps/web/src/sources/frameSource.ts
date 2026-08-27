/**
 * プレビュー用キャンバスへ映像を描くソースの共通インターフェース。
 * Webカメラも、カメラなし環境向けのシミュレーションも同じ形で扱う。
 */
export interface FrameSource {
  readonly label: string;
  start(): Promise<void>;
  stop(): void;
  /** 現在の映像を ctx に w×h で描く。tMs は start からの経過ミリ秒。 */
  render(ctx: CanvasRenderingContext2D, w: number, h: number, tMs: number): void;
}

export type SourceId = "webcam" | "sim-drawing" | "sim-handwriting";
