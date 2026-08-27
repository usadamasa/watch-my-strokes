import type { FrameSource } from "./frameSource.ts";

/** getUserMedia のWebカメラ映像を描くソース。 */
export class WebcamSource implements FrameSource {
  readonly label = "Webカメラ";
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        // 紙を上から撮る用途では背面カメラを優先
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;
  }

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.video = null;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.video || this.video.readyState < 2) {
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    ctx.drawImage(this.video, 0, 0, w, h);
  }
}
