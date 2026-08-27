import { describe, expect, test } from "bun:test";
import {
  gate,
  initialThrottleState,
  markInFlight,
  markSpoke,
  type ThrottleConfig,
} from "../src/lib/cooldown.ts";

const cfg: ThrottleConfig = { minChangeScore: 0.001, cooldownMs: 8000 };

describe("gate", () => {
  test("初回(未発話)で変化があれば ask", () => {
    expect(gate(initialThrottleState, 1000, 0.5, cfg)).toBe("ask");
  });

  test("変化が閾値未満なら skip-nochange(境界値ちょうどは ask)", () => {
    expect(gate(initialThrottleState, 1000, 0.0009, cfg)).toBe("skip-nochange");
    expect(gate(initialThrottleState, 1000, 0.001, cfg)).toBe("ask");
  });

  test("クールダウン中は大きな変化でも skip-cooldown", () => {
    const state = markSpoke(initialThrottleState, 10_000);
    expect(gate(state, 10_000 + 7999, 0.9, cfg)).toBe("skip-cooldown");
    expect(gate(state, 10_000 + 8000, 0.9, cfg)).toBe("ask");
  });

  test("問い合わせ中は skip-inflight", () => {
    const state = markInFlight(initialThrottleState, true);
    expect(gate(state, 1000, 0.9, cfg)).toBe("skip-inflight");
  });

  test("markSpoke で inFlight も解除される", () => {
    const state = markSpoke(markInFlight(initialThrottleState, true), 500);
    expect(state.inFlight).toBe(false);
    expect(state.lastSpokeAt).toBe(500);
  });
});
