/**
 * 思考発話（think-aloud）を促すかどうかの判定。
 *
 * 音の入出力は preview でも検証できないため、「いつ促すか」の判断だけを
 * 純関数に切り出して単体テストで固めている（docs/LESSONS.md の成功パターン）。
 * フック側（useSilenceNudge）は音量を測ってこの関数に渡すだけにする。
 */

/** これを超えたら発話とみなす（時間領域の RMS）。静かな部屋の暗騒音は概ね 0.005 未満 */
export const SPEECH_RMS = 0.012

export interface NudgeState {
  /** 最後に発話を検知した時刻（ms） */
  lastSpeechAt: number
  /** このタスクで既に促した回数 */
  nudgeCount: number
}

export interface NudgeRule {
  /** 最初の声かけまでの沈黙秒数 */
  silenceSec: number
  /** 2回目以降に必要な追加の沈黙秒数 */
  repeatSec: number
  /** 1タスクあたりの上限。促しすぎると参加者を追い詰める */
  maxNudges: number
}

/**
 * いま促すべきか。
 *
 * 「話していない時間」が基準を超えたときだけ true。1回目より2回目を長く待つのは、
 * 黙って考え込んでいる人を数十秒おきに急かさないため。上限に達したらもう促さない
 * （それでも話さない人は、促し方の問題ではなく話したくないのだと扱う）。
 */
export function shouldNudge(now: number, state: NudgeState, rule: NudgeRule): boolean {
  if (state.nudgeCount >= rule.maxNudges) return false
  const needSec = state.nudgeCount === 0 ? rule.silenceSec : rule.repeatSec
  return now - state.lastSpeechAt >= needSec * 1000
}

/** 発話とみなす音量か（1回の観測ぶん） */
export function isSpeech(rms: number): boolean {
  return rms > SPEECH_RMS
}

/**
 * 観測1回ぶんを受けて、次の状態と「促し判定に進んでよいか」を返す。
 *
 * ルールは2つ。
 *   1. 大きい観測が2回続いたときだけ発話とみなす（クリック音・キー入力の
 *      一瞬のピークで沈黙の計測をリセットしない）
 *   2. **大きい観測のフレームでは促し判定に進まない**。20秒の境界がちょうど
 *      話し始めと重なると、参加者の第一声に促しが被る。体験として最悪の失敗なので、
 *      迷ったら促さない側に倒す
 */
export function nextFrame(prevLoud: boolean, loud: boolean): {
  prevLoud: boolean
  /** 沈黙の計測をリセットするか（＝発話とみなしたか） */
  sawSpeech: boolean
  /** 促すかどうかの判定に進んでよいか */
  canNudge: boolean
} {
  if (loud) return { prevLoud: true, sawSpeech: prevLoud, canNudge: false }
  return { prevLoud: false, sawSpeech: false, canNudge: true }
}
