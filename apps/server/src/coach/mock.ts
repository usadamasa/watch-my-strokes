import type { CoachDecision, CoachFocus } from "@wms/shared";
import type { CoachContext, CoachProvider } from "./provider.ts";

/**
 * APIキーなしでコーチ挙動を決定論的に模倣するプロバイダ。
 * クライアントが算出したメタ情報(インク被覆率・変化量)から
 * 「観察 → 大枠 → 位置・角度 → 線質 → 細部」と指導段階を進め、
 * 変化が小さいときや直近で指摘したばかりのときは黙る。
 */

const MESSAGES: Record<CoachFocus, Record<"drawing" | "handwriting", string[]>> = {
  proportions: {
    drawing: [
      "細部より先に、全体のアタリを薄い線で取りましょう。紙の中央に大きく。",
      "モチーフ全体の縦横比を先に決めましょう。今は細部に入るのが早いです。",
    ],
    handwriting: [
      "文字の大きさを揃えることを最優先に。1行目と同じ高さを意識しましょう。",
      "まず字の外形(四角の枠)をイメージしてから書き始めましょう。",
    ],
  },
  position: {
    drawing: [
      "全体が右に寄っています。次の線から中心を少し左に意識しましょう。",
      "水平の基準線に対して傾いています。紙を回さず、手首の角度を直しましょう。",
    ],
    handwriting: [
      "行がだんだん右下がりになっています。ガイド線を意識して水平に戻しましょう。",
      "文字の間隔が詰まってきました。半文字分の間隔を保ちましょう。",
    ],
  },
  "line-quality": {
    drawing: [
      "線が途切れがちです。肘から動かして、一本の線を一息で引きましょう。",
      "同じ線を何度もなぞっています。迷い線を減らし、一本で決めましょう。",
    ],
    handwriting: [
      "線が震えています。ペンを少し寝かせ、筆圧を抜いてみましょう。",
      "はね・はらいが弱いです。最後まで気を抜かず筆を運びましょう。",
    ],
  },
  details: {
    drawing: [
      "全体のバランスは良いです。影を入れる前に輪郭の交差部を整えましょう。",
      "仕上げに入って良い段階です。最も手前の輪郭だけ線を強くしましょう。",
    ],
    handwriting: [
      "全体は整っています。とめ・はねの終筆だけ丁寧に確認しましょう。",
      "良いペースです。画数の多い字だけ少し大きめに書くと読みやすくなります。",
    ],
  },
};

/**
 * 判定閾値。クライアントは固定解像度(192×144)の解析キャンバスで
 * changeScore / inkRatio を算出するため、線画のインク被覆率は
 * 数%以下のスケールになる。それに合わせた値。
 */
export const MOCK_THRESHOLDS = {
  /** これ未満はほぼ白紙 */
  blankInkRatio: 0.0015,
  /** これ未満は意味のある進捗なし */
  minChangeScore: 0.0004,
  /** 同じ観点を繰り返してよい「大きな変化」 */
  bigChangeScore: 0.003,
  /** 直近の指摘から空けるフレーム数 */
  adviceFrameGap: 3,
  /** 指導段階の境界(inkRatio) */
  stages: { proportions: 0.008, position: 0.016, lineQuality: 0.026 },
} as const;

/** インク被覆率から指導段階を推定する。 */
export function stageFor(inkRatio: number): CoachFocus {
  const s = MOCK_THRESHOLDS.stages;
  if (inkRatio < s.proportions) return "proportions";
  if (inkRatio < s.position) return "position";
  if (inkRatio < s.lineQuality) return "line-quality";
  return "details";
}

/** 決定ロジック本体(テスト可能な純関数)。 */
export function mockDecide(ctx: CoachContext): CoachDecision {
  const latest = ctx.frames[ctx.frames.length - 1];
  if (!latest) return { intervene: false };
  const m = latest.metrics;

  const th = MOCK_THRESHOLDS;
  // 最初の1〜2フレームは観察に徹する
  if (m.frameIndex < 2) return { intervene: false };
  // まだほとんど描かれていない
  if (m.inkRatio < th.blankInkRatio) return { intervene: false };
  // 意味のある進捗がない
  if (m.changeScore < th.minChangeScore) return { intervene: false };

  const last = ctx.adviceHistory[ctx.adviceHistory.length - 1];
  // 直近の指摘から間もないなら黙る
  if (last && m.frameIndex - last.frameIndex < th.adviceFrameGap) {
    return { intervene: false };
  }

  const focus = stageFor(m.inkRatio);
  // 同じ観点を、状況が大きく変わっていないのに繰り返さない
  if (last && last.decision.focus === focus && m.changeScore < th.bigChangeScore) {
    return { intervene: false };
  }

  const variants = MESSAGES[focus][ctx.mode];
  const message = variants[m.frameIndex % variants.length]!;
  return { intervene: true, message, focus };
}

export class MockCoach implements CoachProvider {
  readonly id = "mock" as const;

  async decide(ctx: CoachContext): Promise<CoachDecision> {
    return mockDecide(ctx);
  }
}
