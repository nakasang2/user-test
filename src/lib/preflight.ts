/**
 * 参加前チェック（プリフライト）の判定ロジック。
 *
 * カメラ・マイク・音声再生・画面共有はブラウザの実挙動が絡むため preview では検証できない。
 * 「何をもって合格とするか」だけを純関数に切り出し、単体テストで固定する。
 * （docs/LESSONS.md「UIを介さず検証できる部分は関数として切り出す」に従う）
 */

export type StepId = 'browser' | 'camera' | 'mic' | 'audio' | 'widget' | 'screen'

export interface Capabilities {
  /** Chromium 系（Chrome / Edge）か */
  chromium: boolean
  /** Brave か。Chromium 系だが音声認識がブロックされる */
  brave: boolean
  getUserMedia: boolean
  speechRecognition: boolean
  /** Document Picture-in-Picture（常に最前面の小窓） */
  documentPiP: boolean
  getDisplayMedia: boolean
}

/**
 * 調査タイプごとに必要なステップ。
 * service モード（実サービスを別タブで操作）だけは小窓と画面録画を使うので、
 * 本番で初めて失敗しないよう事前に一度通しておく。
 */
export function stepsFor(type: string | undefined, usabilityMode: string | null | undefined): StepId[] {
  const base: StepId[] = ['browser', 'camera', 'mic', 'audio']
  if (type === 'usability' && usabilityMode === 'service') return [...base, 'widget', 'screen']
  return base
}

/**
 * ブラウザステップの合否。
 *
 * 「その調査で実際に使う機能」だけを見る。プロトタイプテストに画面録画は要らないので、
 * 使わない機能の欠落で参加を断らない。
 * 理由は参加者がとれる行動に直結する順（ブラウザを変える → 機能不足）で返す。
 */
export function browserVerdict(
  caps: Capabilities,
  steps: StepId[]
): { ok: boolean; reason: string | null } {
  if (caps.brave) {
    return { ok: false, reason: 'Brave では音声認識がブロックされるため、この調査には参加できません。' }
  }
  if (!caps.chromium) {
    return { ok: false, reason: 'Google Chrome または Microsoft Edge でお開きください。' }
  }
  if (!caps.getUserMedia) {
    return { ok: false, reason: 'このブラウザではカメラ・マイクを利用できません。' }
  }
  if (!caps.speechRecognition) {
    return { ok: false, reason: 'このブラウザは音声認識に対応していません。' }
  }
  if (steps.includes('widget') && !caps.documentPiP) {
    return { ok: false, reason: 'このブラウザは、常に最前面に表示される小窓に対応していません。Chrome を最新版に更新してください。' }
  }
  if (steps.includes('screen') && !caps.getDisplayMedia) {
    return { ok: false, reason: 'このブラウザは画面の録画に対応していません。' }
  }
  return { ok: true, reason: null }
}

export type FaceStatus = 'ok' | 'no_face' | 'cut_off'

/**
 * 顔が枠に収まっているか。
 * 判定規則は小窓（widget）と useEmotionDetection の実行中チェックと同じにする
 * （事前に OK だったのに開始した途端に警告が出ると、直しようがなく不信を招く）。
 */
export function faceFraming(
  box: { x: number; y: number; width: number; height: number } | null,
  videoWidth: number,
  videoHeight: number
): FaceStatus {
  if (!box) return 'no_face'
  const mx = Math.max(6, videoWidth * 0.015)
  const my = Math.max(6, videoHeight * 0.015)
  const cut =
    box.x <= mx ||
    box.y <= my ||
    box.x + box.width >= videoWidth - mx ||
    box.y + box.height >= videoHeight - my
  return cut ? 'cut_off' : 'ok'
}

/**
 * 顔が見つからないまま進めるようになるまでの猶予（ミリ秒）。
 *
 * 顔が写っている人にはこの逃げ道を見せない。すぐ出すと、直せる人まで
 * 「このまま進む」を押してしまい、チェックの意味が無くなる。
 */
export const FACE_GRACE_MS = 8000

/**
 * カメラステップの通過判定。
 *
 * カメラが映っていることは必須。一方で**顔の位置は警告にとどめて止めない**。
 * 暗い場所などでは顔検出が失敗し続けることがあり、そこで完全に止めると
 * 参加者側に直しようがなく、その人を確実に失うため。
 */
export function cameraGate(opts: {
  camOn: boolean
  faceCheckAvailable: boolean
  faceStatus: FaceStatus | null
  graceOver: boolean
}): { canProceed: boolean; bypass: boolean } {
  if (!opts.camOn) return { canProceed: false, bypass: false }
  // 判定できない環境では、映像が出ていることだけを条件にする
  if (!opts.faceCheckAvailable) return { canProceed: true, bypass: false }
  if (opts.faceStatus === 'ok') return { canProceed: true, bypass: false }
  return { canProceed: false, bypass: opts.graceOver }
}

/**
 * マイク合格に必要な「発話とみなせるフレーム」の連続数。
 * 1フレームで通すと、キーボードの打鍵音やドアの音だけで合格してしまう。
 */
export const MIC_OK_FRAMES = 3

/** 連続カウンタの更新。静かになったら 0 に戻す（断続的なノイズを積み上げない） */
export function nextMicFrames(prev: number, loud: boolean): number {
  return loud ? prev + 1 : 0
}

export function micPassed(frames: number): boolean {
  return frames >= MIC_OK_FRAMES
}

/**
 * 画面共有で「画面全体」が選ばれたか。
 *
 * タブやウィンドウだけを共有されると、参加者が別タブへ移った操作が録画に残らない。
 * ただし displaySurface を報告しないブラウザもあるため、取れない場合は通す
 * （検証できないことを不合格にすると、確かめようがない理由で参加を断ることになる）。
 */
export function screenShareVerdict(
  displaySurface: string | undefined
): { ok: boolean; reason: string | null } {
  if (!displaySurface || displaySurface === 'monitor') return { ok: true, reason: null }
  const what = displaySurface === 'browser' ? 'タブ' : 'ウィンドウ'
  return {
    ok: false,
    reason: `${what}だけが選ばれています。もう一度試して「画面全体」を選んでください。`,
  }
}
