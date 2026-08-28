/** コーチングの対象モード。 */
export type CoachMode = "drawing" | "handwriting";

/** フィードバック生成のプロバイダ。 */
export type ProviderId = "anthropic" | "mock";

/** クライアント側で算出したフレームのメタ情報。 */
export interface FrameMetrics {
  /** セッション開始からのキャプチャ通番(スキップ分を含む)。 */
  frameIndex: number;
  /** セッション開始からの経過ミリ秒。 */
  elapsedMs: number;
  /** 前回「送信した」フレームとの変化量 0..1。 */
  changeScore: number;
  /** 暗い画素(=インク)の被覆率 0..1。 */
  inkRatio: number;
}

export interface CreateSessionRequest {
  mode: CoachMode;
  /** 省略時はサーバー既定(Anthropic の認証情報が解決できれば anthropic、なければ mock)。 */
  provider?: ProviderId;
}

export interface CreateSessionResponse {
  sessionId: string;
  provider: ProviderId;
  model?: string;
}

export interface FrameRequest {
  /** data URL プレフィックスなしの base64。 */
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png";
  metrics: FrameMetrics;
}

export type CoachFocus = "proportions" | "position" | "line-quality" | "details";

/** コーチの判断。intervene=false のときは黙って見守る。 */
export interface CoachDecision {
  intervene: boolean;
  /** 1つだけの実行可能な提案。日本語・80文字以内。 */
  message?: string;
  focus?: CoachFocus;
}

export interface FrameResponse extends CoachDecision {
  provider: ProviderId;
  latencyMs: number;
}

/** セッションタイムラインのイベント種別。 */
export type SessionEventType =
  | "info"
  | "capture"
  | "skip-nochange"
  | "skip-cooldown"
  | "skip-inflight"
  | "ask"
  | "advice"
  | "silent"
  | "speak"
  | "error";

export interface SessionEvent {
  /** セッション開始からの経過ミリ秒。 */
  t: number;
  type: SessionEventType;
  detail?: string;
  metrics?: Partial<FrameMetrics>;
}
