/**
 * フレーム比較のための純関数群。Canvas の ImageData(RGBA)を前提とするが、
 * 生の配列を受け取るためテスト・サーバーどちらからも使える。
 */

/** RGBA配列をグレースケール(輝度)配列へ変換する。 */
export function toGrayscale(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    // ITU-R BT.601 luma
    out[j] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
  }
  return out;
}

/**
 * 2枚のグレースケール画像の変化量 0..1。
 * JPEGノイズ・照明ゆらぎに強くするため、画素ごとの差が deadband を
 * 超えた画素の「割合」を返す(平均差ではなく)。
 */
export function changeScore(
  a: Uint8Array,
  b: Uint8Array,
  deadband = 24,
): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > deadband) changed++;
  }
  return changed / a.length;
}

/** 暗い画素(=インク)の被覆率 0..1。白い紙の上のペン線を想定。 */
export function inkRatio(gray: Uint8Array, threshold = 140): number {
  if (gray.length === 0) return 0;
  let dark = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i]! < threshold) dark++;
  }
  return dark / gray.length;
}
