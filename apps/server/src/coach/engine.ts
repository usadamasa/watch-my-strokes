import type { CoachMode, FrameRequest, FrameResponse, ProviderId } from "@wms/shared";
import type { AdviceRecord, CoachProvider, StoredFrame } from "./provider.ts";

/** 文脈として保持するフレーム数(画像トークンの上限)。 */
const MAX_FRAMES = 3;
/** 保持する指摘履歴の上限。 */
const MAX_ADVICE = 8;

interface Session {
  id: string;
  mode: CoachMode;
  provider: CoachProvider;
  frames: StoredFrame[];
  adviceHistory: AdviceRecord[];
}

export class CoachEngine {
  private sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private providerFactory: (id?: ProviderId) => CoachProvider) {}

  createSession(
    mode: CoachMode,
    providerId?: ProviderId,
  ): {
    sessionId: string;
    provider: ProviderId;
    model?: string;
  } {
    const provider = this.providerFactory(providerId);
    const id = `s${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(id, {
      id,
      mode,
      provider,
      frames: [],
      adviceHistory: [],
    });
    const model = provider.model;
    return model !== undefined
      ? { sessionId: id, provider: provider.id, model }
      : { sessionId: id, provider: provider.id };
  }

  async handleFrame(sessionId: string, req: FrameRequest): Promise<FrameResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    session.frames.push({
      imageBase64: req.imageBase64,
      mediaType: req.mediaType,
      metrics: req.metrics,
    });
    if (session.frames.length > MAX_FRAMES) {
      session.frames.splice(0, session.frames.length - MAX_FRAMES);
    }

    const startedAt = performance.now();
    const decision = await session.provider.decide({
      mode: session.mode,
      frames: session.frames,
      adviceHistory: session.adviceHistory,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (decision.intervene) {
      session.adviceHistory.push({
        frameIndex: req.metrics.frameIndex,
        elapsedMs: req.metrics.elapsedMs,
        decision,
      });
      if (session.adviceHistory.length > MAX_ADVICE) {
        session.adviceHistory.splice(0, session.adviceHistory.length - MAX_ADVICE);
      }
    }

    return { ...decision, provider: session.provider.id, latencyMs };
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session not found: ${sessionId}`);
  }
}
