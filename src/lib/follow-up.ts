/**
 * 深掘り（追加質問）の設定。
 *
 * 深さの範囲を UI 3画面（手動作成・AI設計・編集）と API 2本（作成・編集）、
 * さらに進行側（/api/interviewer）で別々に書くと、片方だけ直して食い違う。
 * 範囲と既定値はここだけに置く。
 */

/** 深さの下限。0 は「深掘りしない」であり followUpEnabled=false で表すので、最小は 1 */
export const FOLLOW_UP_DEPTH_MIN = 1
/**
 * 深さの上限。
 * 1つの質問で5回続けて追い質問されると、参加者は尋問されている感覚になり
 * 後半の回答が浅くなる。それ以上を許す実益がないので5で止める。
 */
export const FOLLOW_UP_DEPTH_MAX = 5
/** 既定値。従来ハードコードされていた回数と同じなので、既存調査の挙動を変えない */
export const FOLLOW_UP_DEPTH_DEFAULT = 2

/**
 * 受け取った深さを安全な整数に丸める。
 * 不正値（文字列・小数・範囲外・undefined）はすべて既定値に寄せる。
 * 参加者側の進行に効く値なので、おかしな値で無限に深掘りされないようにする。
 */
export function normalizeFollowUpDepth(value: unknown): number {
  // 未指定は既定値。null や空文字を Number() に通すと 0 になり、
  // 「未指定」が「最小値」に化けてしまう
  if (value === null || value === undefined || value === '') return FOLLOW_UP_DEPTH_DEFAULT
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return FOLLOW_UP_DEPTH_DEFAULT
  const i = Math.round(n)
  if (i < FOLLOW_UP_DEPTH_MIN) return FOLLOW_UP_DEPTH_MIN
  if (i > FOLLOW_UP_DEPTH_MAX) return FOLLOW_UP_DEPTH_MAX
  return i
}

/**
 * この質問で実際に許される深掘り回数。
 * 無効なら 0（＝AI に判断させる必要すらない）。
 */
export function effectiveFollowUpDepth(q: {
  followUpEnabled?: boolean | null
  followUpDepth?: number | null
}): number {
  if (q.followUpEnabled === false) return 0
  return normalizeFollowUpDepth(q.followUpDepth ?? FOLLOW_UP_DEPTH_DEFAULT)
}

/** 深さの選択肢（UI 用） */
export const FOLLOW_UP_DEPTH_OPTIONS = Array.from(
  { length: FOLLOW_UP_DEPTH_MAX - FOLLOW_UP_DEPTH_MIN + 1 },
  (_, i) => FOLLOW_UP_DEPTH_MIN + i
)
