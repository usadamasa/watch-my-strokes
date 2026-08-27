import type {
  CreateSessionRequest,
  CreateSessionResponse,
  FrameRequest,
  FrameResponse,
} from "@wms/shared";

export async function createSession(
  req: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return (await res.json()) as CreateSessionResponse;
}

export async function sendFrame(
  sessionId: string,
  req: FrameRequest,
): Promise<FrameResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`sendFrame failed: ${res.status}`);
  return (await res.json()) as FrameResponse;
}
