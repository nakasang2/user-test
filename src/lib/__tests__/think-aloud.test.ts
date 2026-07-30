/**
 * 思考発話を促す判定の単体テスト。
 *
 *   npm test
 *
 * 音の入出力は preview でも実機でしか確かめられないので、「いつ促すか」だけを
 * 純関数に切り出してここで固める。促しすぎ（参加者を急かす）と促さなすぎ
 * （黙ったまま終わる）はどちらもテスト結果を左右するので、境界を明示しておく。
 */
import { shouldNudge, isSpeech, nextFrame, SPEECH_RMS, type NudgeState } from '../think-aloud.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}
       got  ${g}
       want ${w}`) }
}

const RULE = { silenceSec: 20, repeatSec: 45, maxNudges: 2 }
const T0 = 1_000_000
const st = (lastSpeechAt: number, nudgeCount: number): NudgeState => ({ lastSpeechAt, nudgeCount })

console.log('\n=== 思考発話の促し（沈黙検知） ===')

console.log('■ 1回目は 20 秒の沈黙で促す')
eq('19秒では促さない', shouldNudge(T0 + 19_000, st(T0, 0), RULE), false)
eq('ちょうど20秒で促す（境界を含む）', shouldNudge(T0 + 20_000, st(T0, 0), RULE), true)
eq('30秒でも促す', shouldNudge(T0 + 30_000, st(T0, 0), RULE), true)

console.log('■ 話していれば促さない（lastSpeechAt が更新される想定）')
eq('直前に発話があれば促さない', shouldNudge(T0 + 1_000, st(T0 + 1_000, 0), RULE), false)

console.log('■ 2回目は追加で 45 秒待つ（数十秒おきに急かさない）')
eq('促した20秒後には促さない', shouldNudge(T0 + 20_000, st(T0, 1), RULE), false)
eq('44秒でも促さない', shouldNudge(T0 + 44_000, st(T0, 1), RULE), false)
eq('45秒で2回目を促す', shouldNudge(T0 + 45_000, st(T0, 1), RULE), true)

console.log('■ 上限に達したら促さない（追い詰めない）')
eq('2回済みなら何分黙っていても促さない', shouldNudge(T0 + 600_000, st(T0, 2), RULE), false)
eq('上限0なら一度も促さない', shouldNudge(T0 + 600_000, st(T0, 0), { ...RULE, maxNudges: 0 }), false)

console.log('■ 発話判定のしきい値')
eq('暗騒音（0.004）は発話ではない', isSpeech(0.004), false)
eq('しきい値ちょうどは発話ではない（超えたときだけ）', isSpeech(SPEECH_RMS), false)
eq('通常の発話（0.05）は発話', isSpeech(0.05), true)
eq('無音（0）は発話ではない', isSpeech(0), false)

console.log('■ 観測フレームの扱い（単発ノイズと話し始め）')
// 大きい観測が2回続いて初めて発話。クリック音1回で沈黙の計測をリセットしない
eq('無音→無音: 発話なし・促し判定へ進む', nextFrame(false, false), { prevLoud: false, sawSpeech: false, canNudge: true })
eq('無音→大: 単発なので発話とみなさない', nextFrame(false, true), { prevLoud: true, sawSpeech: false, canNudge: false })
eq('大→大: 発話とみなす', nextFrame(true, true), { prevLoud: true, sawSpeech: true, canNudge: false })
eq('大→無音: 発話なし・促し判定へ進む', nextFrame(true, false), { prevLoud: false, sawSpeech: false, canNudge: true })
// 20秒の境界がちょうど話し始めと重なっても、第一声に促しを被せない
eq('大きい観測のフレームでは促し判定に進まない（話し始めに被せない）',
   [nextFrame(false, true).canNudge, nextFrame(true, true).canNudge], [false, false])

console.log(`
${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
