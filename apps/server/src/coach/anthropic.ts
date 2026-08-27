import Anthropic from "@anthropic-ai/sdk";
import type { CoachDecision, CoachFocus } from "@wms/shared";
import type { CoachContext, CoachProvider } from "./provider.ts";
import { frameInstruction, systemPrompt } from "./prompt.ts";

const DEFAULT_MODEL = "claude-opus-5";
/** モデルへ渡す画像は直近N枚に制限してトークンを抑える。 */
const MAX_IMAGES = 3;

const FOCUS_VALUES: readonly CoachFocus[] = [
  "proportions",
  "position",
  "line-quality",
  "details",
];

/** モデルのテキスト応答からJSONの判断を取り出す。壊れていたら沈黙にフォールバック。 */
export function parseDecision(text: string): CoachDecision {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { intervene: false };
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    if (raw["intervene"] !== true) return { intervene: false };
    const message =
      typeof raw["message"] === "string" ? raw["message"].slice(0, 120) : undefined;
    if (!message) return { intervene: false };
    const focus = FOCUS_VALUES.includes(raw["focus"] as CoachFocus)
      ? (raw["focus"] as CoachFocus)
      : undefined;
    return focus !== undefined
      ? { intervene: true, message, focus }
      : { intervene: true, message };
  } catch {
    return { intervene: false };
  }
}

export class AnthropicCoach implements CoachProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(model = process.env["COACH_MODEL"] ?? DEFAULT_MODEL) {
    this.model = model;
    this.client = new Anthropic();
  }

  async decide(ctx: CoachContext): Promise<CoachDecision> {
    const frames = ctx.frames.slice(-MAX_IMAGES);
    const latest = frames[frames.length - 1];
    if (!latest) return { intervene: false };

    const images: Anthropic.Beta.BetaImageBlockParam[] = frames.map((f) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: f.mediaType,
        data: f.imageBase64,
      },
    }));

    const adviceSummaries = ctx.adviceHistory
      .slice(-5)
      .map((a) => a.decision.message ?? "")
      .filter((s) => s.length > 0);

    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 1024,
        // 安全側の判断で応答が止まった場合に別モデルで継続する(claude-opus-5 既定の推奨構成)
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        system: systemPrompt(ctx.mode),
        messages: [
          {
            role: "user",
            content: [
              ...images,
              {
                type: "text",
                text: frameInstruction({
                  frameIndex: latest.metrics.frameIndex,
                  elapsedMs: latest.metrics.elapsedMs,
                  changeScore: latest.metrics.changeScore,
                  adviceSummaries,
                }),
              },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") return { intervene: false };
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") return { intervene: false };
      return parseDecision(textBlock.text);
    } catch (error) {
      // コーチは止まるより黙るほうが良い。エラーは記録して沈黙にフォールバック。
      console.error("[anthropic] decide failed:", error);
      return { intervene: false };
    }
  }
}
