/**
 * 質問に紐づける画像（印象テスト）の正規化と検証。
 *
 * 作成モーダル・編集モーダル・AI 設計ページの3画面と、作成 API・編集 API の
 * 計5か所で同じ値を扱う。判定がずれると「保存できたのに参加者側で出ない」
 * 「画面ごとに受理される値が違う」が起きるので、ここに集約する
 * （声かけの分数で実際に起きた。DECISIONS 参照）。
 */

/** 見せ方。null / 不明な値は persistent 扱いにする（画像を足した質問が黙って消えないように） */
export type ImageMode = 'persistent' | 'timed'

export const DEFAULT_IMAGE_DURATION = 5
export const MIN_IMAGE_DURATION = 1
export const MAX_IMAGE_DURATION = 60

export const IMAGE_MODE_LABELS: Record<ImageMode, string> = {
  persistent: '質問に答えている間ずっと表示',
  timed: '先に数秒だけ見せて隠す',
}

export function normalizeImageMode(mode: string | null | undefined): ImageMode {
  return mode === 'timed' ? 'timed' : 'persistent'
}

/** timed のときの秒数。範囲外・未指定は既定値に寄せる（参加者側で 0 秒や負の秒にしない） */
export function imageDurationOrDefault(sec: number | null | undefined): number {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return DEFAULT_IMAGE_DURATION
  const rounded = Math.round(sec)
  if (rounded < MIN_IMAGE_DURATION) return MIN_IMAGE_DURATION
  if (rounded > MAX_IMAGE_DURATION) return MAX_IMAGE_DURATION
  return rounded
}

export interface QuestionImageInput {
  imageUrl?: string | null
  imageMode?: string | null
  imageDuration?: number | null
}

/**
 * 保存用に整える。
 *
 * 画像が無い質問には見せ方も秒数も残さない。残すと、あとで画像を付け直したときに
 * 覚えのない設定が復活する。timed 以外では秒数を持たない（使われない値を保存しない）。
 */
export function toQuestionImagePayload(input: QuestionImageInput): {
  imageUrl: string | null
  imageMode: ImageMode | null
  imageDuration: number | null
} {
  const url = input.imageUrl?.trim()
  if (!url) return { imageUrl: null, imageMode: null, imageDuration: null }
  const mode = normalizeImageMode(input.imageMode)
  return {
    imageUrl: url,
    imageMode: mode,
    imageDuration: mode === 'timed' ? imageDurationOrDefault(input.imageDuration) : null,
  }
}

/**
 * 保存前の検証。問題があれば参加者向けではなくリサーチャー向けの文言を返す。
 * 秒数は `imageDurationOrDefault` が丸めるので、ここでは「明らかな入力ミス」だけを弾く。
 */
export function validateQuestionImage(
  input: QuestionImageInput,
  questionLabel: string
): string | null {
  const url = input.imageUrl?.trim()
  if (!url) return null
  // http(s) 以外を弾く。data: や javascript: を <img src> に流さない
  if (!/^https?:\/\//i.test(url)) {
    return `${questionLabel}の画像URLは http:// または https:// で始まる必要があります`
  }
  if (normalizeImageMode(input.imageMode) === 'timed') {
    const sec = input.imageDuration
    if (sec != null && (!Number.isInteger(sec) || sec < MIN_IMAGE_DURATION || sec > MAX_IMAGE_DURATION)) {
      return `${questionLabel}の表示秒数は ${MIN_IMAGE_DURATION}〜${MAX_IMAGE_DURATION} の整数で入力してください`
    }
  }
  return null
}
