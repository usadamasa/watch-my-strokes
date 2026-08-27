import type {
  CoachDecision,
  CoachMode,
  FrameMetrics,
  ProviderId,
} from "@wms/shared";

export interface StoredFrame {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png";
  metrics: FrameMetrics;
}

export interface AdviceRecord {
  frameIndex: number;
  elapsedMs: number;
  decision: CoachDecision;
}

/** プロバイダへ渡すセッション文脈。frames は古い順で、末尾が現在フレーム。 */
export interface CoachContext {
  mode: CoachMode;
  frames: StoredFrame[];
  /** これまでに intervene=true となった指摘の履歴(古い順)。 */
  adviceHistory: AdviceRecord[];
}

export interface CoachProvider {
  readonly id: ProviderId;
  readonly model?: string;
  decide(ctx: CoachContext): Promise<CoachDecision>;
}
