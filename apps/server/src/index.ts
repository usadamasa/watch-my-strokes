import type {
  CreateSessionRequest,
  CreateSessionResponse,
  FrameRequest,
  ProviderId,
} from "@wms/shared";
import { AnthropicCoach } from "./coach/anthropic.ts";
import { CoachEngine, SessionNotFoundError } from "./coach/engine.ts";
import { MockCoach } from "./coach/mock.ts";
import type { CoachProvider } from "./coach/provider.ts";

const PORT = Number(process.env["PORT"] ?? 8787);

/**
 * プロバイダの解決順: 明示指定 > COACH_PROVIDER 環境変数 >
 * ANTHROPIC_API_KEY があれば anthropic、なければ mock。
 */
function defaultProviderId(): ProviderId {
  const env = process.env["COACH_PROVIDER"];
  if (env === "anthropic" || env === "mock") return env;
  return process.env["ANTHROPIC_API_KEY"] ? "anthropic" : "mock";
}

function makeProvider(id?: ProviderId): CoachProvider {
  const resolved = id ?? defaultProviderId();
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
      GET: () => json({ ok: true, defaultProvider: defaultProviderId() }),
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
  `[server] listening on http://localhost:${server.port} (default provider: ${defaultProviderId()})`,
);
