/**
 * 参加前チェック（プリフライト）の判定の単体テスト。
 *
 *   npm test
 *
 * カメラ・マイク・音声再生・画面共有は preview では動かせないため、
 * 「何をもって合格とするか」だけをここで固める。
 * 今回は完全ブロック方式（通らないと参加できない）なので、
 * 誤って弾く＝参加者を失う。境界を明示しておく。
 */
import {
  stepsFor,
  browserVerdict,
  faceFraming,
  cameraGate,
  nextMicFrames,
  micPassed,
  screenShareVerdict,
  MIC_OK_FRAMES,
  type Capabilities,
} from '../preflight.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}
       got  ${g}
       want ${w}`) }
}

const CHROME: Capabilities = {
  chromium: true, brave: false, getUserMedia: true,
  speechRecognition: true, documentPiP: true, getDisplayMedia: true,
}
const caps = (patch: Partial<Capabilities>): Capabilities => ({ ...CHROME, ...patch })

console.log('\n=== 参加前チェック ===')

console.log('■ 調査タイプごとの必要ステップ')
eq('インタビューは共通4つ', stepsFor('interview', null), ['browser', 'camera', 'mic', 'audio'])
eq('印象テストも共通4つ', stepsFor('impression', null), ['browser', 'camera', 'mic', 'audio'])
eq('プロトタイプは共通4つ（小窓も画面録画も使わない）',
  stepsFor('usability', 'prototype'), ['browser', 'camera', 'mic', 'audio'])
eq('実サービスは小窓と画面録画を追加',
  stepsFor('usability', 'service'), ['browser', 'camera', 'mic', 'audio', 'widget', 'screen'])
eq('タイプ未指定でも落ちない', stepsFor(undefined, undefined), ['browser', 'camera', 'mic', 'audio'])

console.log('■ ブラウザ判定')
const SERVICE = stepsFor('usability', 'service')
const BASIC = stepsFor('interview', null)
eq('Chrome は通る', browserVerdict(CHROME, SERVICE).ok, true)
eq('Brave は弾く', browserVerdict(caps({ brave: true }), BASIC).ok, false)
eq('Brave は Chromium 系でも弾く（音声認識がブロックされるため）',
  browserVerdict(caps({ brave: true, chromium: true }), BASIC).ok, false)
eq('Chromium 系でなければ弾く', browserVerdict(caps({ chromium: false }), BASIC).ok, false)
eq('カメラAPIが無ければ弾く', browserVerdict(caps({ getUserMedia: false }), BASIC).ok, false)
eq('音声認識が無ければ弾く', browserVerdict(caps({ speechRecognition: false }), BASIC).ok, false)

console.log('■ 使わない機能の欠落では弾かない（過剰ブロックの防止）')
eq('小窓が無くてもインタビューは通る', browserVerdict(caps({ documentPiP: false }), BASIC).ok, true)
eq('画面録画が無くてもインタビューは通る', browserVerdict(caps({ getDisplayMedia: false }), BASIC).ok, true)
eq('小窓が無いと実サービスのテストは弾く', browserVerdict(caps({ documentPiP: false }), SERVICE).ok, false)
eq('画面録画が無いと実サービスのテストは弾く', browserVerdict(caps({ getDisplayMedia: false }), SERVICE).ok, false)
eq('理由は必ず返す', typeof browserVerdict(caps({ chromium: false }), BASIC).reason, 'string')

console.log('■ 顔のフレーミング（実行中の警告と同じ規則）')
eq('顔が無い', faceFraming(null, 640, 480), 'no_face')
eq('中央にいれば OK', faceFraming({ x: 200, y: 150, width: 200, height: 200 }, 640, 480), 'ok')
eq('左端に接していたら見切れ', faceFraming({ x: 5, y: 150, width: 200, height: 200 }, 640, 480), 'cut_off')
eq('上端に接していたら見切れ', faceFraming({ x: 200, y: 3, width: 200, height: 200 }, 640, 480), 'cut_off')
eq('右端に接していたら見切れ', faceFraming({ x: 430, y: 150, width: 205, height: 200 }, 640, 480), 'cut_off')
eq('下端に接していたら見切れ', faceFraming({ x: 200, y: 275, width: 200, height: 200 }, 640, 480), 'cut_off')
eq('小さい映像でも最低6pxのマージンが効く',
  faceFraming({ x: 5, y: 20, width: 50, height: 50 }, 100, 100), 'cut_off')

console.log('■ カメラの通過判定（顔の位置は警告にとどめて止めない）')
const gate = (patch: Partial<Parameters<typeof cameraGate>[0]>) =>
  cameraGate({ camOn: true, faceCheckAvailable: true, faceStatus: 'ok', graceOver: false, ...patch })
eq('カメラが映っていなければ進めない', gate({ camOn: false }), { canProceed: false, bypass: false })
eq('顔が枠に入っていれば進める', gate({ faceStatus: 'ok' }), { canProceed: true, bypass: false })
eq('顔の判定ができない環境は映像だけで進める',
  gate({ faceCheckAvailable: false, faceStatus: null }), { canProceed: true, bypass: false })
eq('顔が見つからないうちは主ボタンを出さない',
  gate({ faceStatus: 'no_face' }), { canProceed: false, bypass: false })
eq('見切れているうちも主ボタンを出さない',
  gate({ faceStatus: 'cut_off' }), { canProceed: false, bypass: false })
eq('猶予を過ぎたら「このまま進む」を出す（暗所などで詰ませない）',
  gate({ faceStatus: 'no_face', graceOver: true }), { canProceed: false, bypass: true })
eq('顔が写っている人には猶予後も逃げ道を見せない',
  gate({ faceStatus: 'ok', graceOver: true }), { canProceed: true, bypass: false })
eq('カメラが無ければ猶予後でも逃げ道は出さない',
  gate({ camOn: false, graceOver: true }), { canProceed: false, bypass: false })

console.log('■ マイクの検出（単発ノイズで合格させない）')
eq('必要フレーム数は3', MIC_OK_FRAMES, 3)
eq('静かなら0のまま', nextMicFrames(0, false), 0)
eq('鳴れば加算', nextMicFrames(0, true), 1)
eq('静かになったらリセット（断続ノイズを積み上げない）', nextMicFrames(2, false), 0)
eq('2フレームでは未合格', micPassed(2), false)
eq('3フレームで合格', micPassed(3), true)
eq('打鍵音1回では合格しない', micPassed(nextMicFrames(nextMicFrames(0, true), false)), false)

console.log('■ 画面共有の選択')
eq('画面全体なら OK', screenShareVerdict('monitor').ok, true)
eq('タブだけなら やり直し', screenShareVerdict('browser').ok, false)
eq('ウィンドウだけなら やり直し', screenShareVerdict('window').ok, false)
eq('タブのときは文言に「タブ」を含める', screenShareVerdict('browser').reason?.includes('タブ'), true)
eq('報告されない場合は通す（確かめようがない理由で断らない）', screenShareVerdict(undefined).ok, true)

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
