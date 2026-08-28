import type {
  CreateSessionRequest,
  CreateSessionResponse,
  FrameRequest,
  ProviderId,
} from "@wms/shared";
import { AnthropicCoach } from "./coach/anthropic.ts";
import { resolveDefaultProviderId } from "./coach/credentials.ts";
import { CoachEngine, SessionNotFoundError } from "./coach/engine.ts";
import { MockCoach } from "./coach/mock.ts";
import type { CoachProvider } from "./coach/provider.ts";

const PORT = Number(process.env.PORT ?? 8787);

/**
 * 起動時に一度だけ解決する既定プロバイダ。
 * 解決順: COACH_PROVIDER 環境変数 > SDK が認証情報(API キー / ant auth login のプロファイル /
 * Workload Identity Federation)を解決できれば anthropic、できなければ mock。
 * 起動後に `ant auth login` しても反映されないので、その場合はサーバーを再起動する。
 */
const DEFAULT_PROVIDER: ProviderId = await resolveDefaultProviderId();

/** セッション作成時の解決順: 明示指定 > 起動時に解決した既定。 */
function makeProvider(id?: ProviderId): CoachProvider {
  const resolved = id ?? DEFAULT_PROVIDER;
  return resolved === "anthropic" ? new AnthropicCoach() : new MockCoach();
}

const engine = new CoachEngine(makeProvider);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/health": {
      GET: () => json({ ok: true, defaultProvider: DEFAULT_PROVIDER }),
    },
    "/api/sessions": {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async (req) => {
        const body = (await req.json()) as CreateSessionRequest;
        if (body.mode !== "drawing" && body.mode !== "handwriting") {
          return json({ error: "mode must be 'drawing' or 'handwriting'" }, 400);
        }
        const result: CreateSessionResponse = engine.createSession(
          body.mode,
          body.provider,
        );
        return json(result, 201);
      },
    },
    "/api/sessions/:id/frames": {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async (req) => {
        const body = (await req.json()) as FrameRequest;
        if (!body.imageBase64 || !body.metrics) {
          return json({ error: "imageBase64 and metrics are required" }, 400);
        }
        try {
          const result = await engine.handleFrame(req.params.id, body);
          return json(result);
        } catch (error) {
          if (error instanceof SessionNotFoundError) {
            return json({ error: error.message }, 404);
          }
          throw error;
        }
      },
    },
  },
  fetch() {
    return json({ error: "not found" }, 404);
  },
});

console.log(
  `[server] listening on http://localhost:${server.port} (default provider: ${DEFAULT_PROVIDER})`,
);
if (DEFAULT_PROVIDER === "mock" && !process.env.COACH_PROVIDER) {
  console.log(
    "[server] Claude を使うには ANTHROPIC_API_KEY を設定するか `ant auth login` してから再起動する",
  );
}
