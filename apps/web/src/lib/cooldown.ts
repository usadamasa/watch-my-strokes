/**
 * フィードバック抑制の状態機械(Issue #1 の throttling ロジック)。
 *
 *   last feedback → minimum cooldown → significant change? → ask
 *
 * 副作用を持たない純関数として実装し、単体テストで境界を担保する。
 */

export interface ThrottleConfig {
  /** これ未満の changeScore は「意味のある変化なし」としてスキップ。 */
  minChangeScore: number;
  /** 最後の発話からこのミリ秒の間は問い合わせない。 */
  cooldownMs: number;
}

export interface ThrottleState {
  /** 最後に発話した時刻(ms)。未発話なら null。 */
  lastSpokeAt: number | null;
  /** 問い合わせが飛んでいる間は次を送らない。 */
  inFlight: boolean;
}

export type GateResult = "ask" | "skip-nochange" | "skip-cooldown" | "skip-inflight";

export const initialThrottleState: ThrottleState = {
  lastSpokeAt: null,
  inFlight: false,
};

/** このフレームをモデルに問い合わせるべきか判定する。 */
export function gate(
  state: ThrottleState,
  now: number,
  score: number,
  cfg: ThrottleConfig,
): GateResult {
  if (state.inFlight) return "skip-inflight";
  if (score < cfg.minChangeScore) return "skip-nochange";
  if (state.lastSpokeAt !== null && now - state.lastSpokeAt < cfg.cooldownMs) {
    return "skip-cooldown";
  }
  return "ask";
}

export function markInFlight(state: ThrottleState, inFlight: boolean): ThrottleState {
  return { ...state, inFlight };
}

/** 発話した瞬間に呼び、クールダウンを開始する。 */
export function markSpoke(state: ThrottleState, now: number): ThrottleState {
  return { lastSpokeAt: now, inFlight: false };
}
