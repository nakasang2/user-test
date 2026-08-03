'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Globe,
  Video,
  Mic,
  Volume2,
  PictureInPicture2,
  MonitorUp,
  AlertCircle,
  Copy,
  Lock,
  Loader2,
} from 'lucide-react'
import { isSpeech } from '@/lib/think-aloud'
import {
  stepsFor,
  browserVerdict,
  faceFraming,
  cameraGate,
  FACE_GRACE_MS,
  nextMicFrames,
  micPassed,
  screenShareVerdict,
  type Capabilities,
  type FaceStatus,
  type StepId,
} from '@/lib/preflight'

/**
 * 参加前チェック（プリフライト）。
 *
 * 従来は「カメラ・マイクが必要です」と文章で伝えるだけで、実際に動くかどうかは
 * テストが始まってから分かった。音が聞こえない・小窓が開かない・画面録画を
 * 選び間違える、はどれも本番中に初めて発覚し、そのセッションは作り直せない。
 *
 * ここで1つずつ実際に動かし、通らなければ先へ進めない（完全ブロック方式）。
 * 名前を入力する前に置くので、参加できない人の空のセッションが作られない。
 */

const STEP_META: Record<StepId, { title: string; icon: React.ReactNode }> = {
  browser: { title: 'ブラウザ',       icon: <Globe className="w-4 h-4" strokeWidth={1.75} /> },
  camera:  { title: 'カメラ',         icon: <Video className="w-4 h-4" strokeWidth={1.75} /> },
  mic:     { title: 'マイク',         icon: <Mic className="w-4 h-4" strokeWidth={1.75} /> },
  audio:   { title: '音声の再生',     icon: <Volume2 className="w-4 h-4" strokeWidth={1.75} /> },
  widget:  { title: '操作用の小窓',   icon: <PictureInPicture2 className="w-4 h-4" strokeWidth={1.75} /> },
  screen:  { title: '画面の録画',     icon: <MonitorUp className="w-4 h-4" strokeWidth={1.75} /> },
}

const TEST_PHRASE = 'テストです。この声が聞こえていれば、音声の準備は完了です。'

export default function PreflightCheck({
  type,
  usabilityMode,
  onComplete,
}: {
  type: string | undefined
  usabilityMode: string | null | undefined
  onComplete: () => void
}) {
  const steps = stepsFor(type, usabilityMode)
  const [done, setDone] = useState<StepId[]>([])
  const [busy, setBusy] = useState<StepId | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── ブラウザ ──
  const [caps, setCaps] = useState<Capabilities | null>(null)

  // ── カメラ ──
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [faceStatus, setFaceStatus] = useState<FaceStatus | null>(null)
  // モデルが読めない環境で顔の判定を必須にすると、直しようがない理由で参加を断ることになる
  const [faceCheckAvailable, setFaceCheckAvailable] = useState(true)
  // 一定時間たっても顔が見つからない人に逃げ道を出す（暗所などで詰ませない）
  const [faceGraceOver, setFaceGraceOver] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceApiRef = useRef<any>(null)

  // ── マイク ──
  const [micStarted, setMicStarted] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micFrames, setMicFrames] = useState(0)

  // ── 音声 ──
  const [audioPlayed, setAudioPlayed] = useState(false)
  const [audioFellBack, setAudioFellBack] = useState(false)

  // ── 後片付け用 ──
  // カメラとマイクは別ストリームで持つ。1つに混ぜると、片方を止めるときに
  // もう片方のトラックまで巻き込む／停止済みトラックが残る
  const videoStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const pipRef = useRef<Window | null>(null)

  const current = steps.find((s) => !done.includes(s)) ?? null
  const isDone = (s: StepId) => done.includes(s)
  const markDone = useCallback((s: StepId) => {
    setError(null)
    setDone((prev) => (prev.includes(s) ? prev : [...prev, s]))
  }, [])

  /* ── 機能検出。Brave の判定だけ非同期 ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any
      const brands: { brand: string }[] = nav.userAgentData?.brands ?? []
      const chromium = brands.length
        ? brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
        // userAgentData が無い環境（Safari / Firefox）は UA 文字列で判定する
        : /Chrome\/|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent)
      let brave = false
      try { brave = (await nav.brave?.isBrave?.()) === true } catch { brave = false }
      if (cancelled) return
      setCaps({
        chromium,
        brave,
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
        speechRecognition: !!(win.SpeechRecognition || win.webkitSpeechRecognition),
        documentPiP: !!win.documentPictureInPicture,
        getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      })
    })()
    return () => { cancelled = true }
  }, [])

  /* ── 顔検出モデル。読めなくてもチェック自体は続行できるようにする ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const faceapi = await import('@vladmandic/face-api')
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        if (!cancelled) faceApiRef.current = faceapi
      } catch (err) {
        console.warn('[Preflight] 顔検出モデルのロードに失敗（顔の位置チェックは省略）:', err)
        if (!cancelled) setFaceCheckAvailable(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ── 顔が見つからないまま一定時間たったら逃げ道を出す ── */
  useEffect(() => {
    if (!camOn) return
    const t = setTimeout(() => setFaceGraceOver(true), FACE_GRACE_MS)
    return () => clearTimeout(t)
  }, [camOn])

  /* ── 顔の位置を定期判定（カメラ表示中のみ） ── */
  useEffect(() => {
    if (!camOn || isDone('camera')) return
    const timer = setInterval(async () => {
      const faceapi = faceApiRef.current
      const video = videoRef.current
      if (!faceapi || !video || video.readyState < 2 || !video.videoWidth) return
      try {
        const det = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 })
        )
        setFaceStatus(faceFraming(det?.box ?? null, video.videoWidth, video.videoHeight))
      } catch {
        /* フレームが取れないだけなので無視 */
      }
    }, 1200)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn, done])

  /* ── 後片付け。カメラのランプが点いたままにならないよう必ず止める ── */
  useEffect(() => {
    return () => {
      videoStreamRef.current?.getTracks().forEach((t) => t.stop())
      audioStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (meterRef.current) clearInterval(meterRef.current)
      audioCtxRef.current?.close().catch(() => {})
      audioElRef.current?.pause()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      try { pipRef.current?.close() } catch { /* 既に閉じている */ }
    }
  }, [])

  async function startCamera() {
    setBusy('camera'); setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      // 再試行で古いストリームが残らないよう、先に止めてから差し替える
      videoStreamRef.current?.getTracks().forEach((t) => t.stop())
      videoStreamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCamOn(true)
    } catch {
      setError('カメラを開始できませんでした。アドレスバーのカメラアイコンから「許可」を選び、他のアプリがカメラを使っていないか確認してください。')
    } finally {
      setBusy(null)
    }
  }

  async function startMic() {
    setBusy('mic'); setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current?.getTracks().forEach((t) => t.stop())
      audioStreamRef.current = stream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)

      // 100ms 刻みで測る。requestAnimationFrame（約16ms）だと、必要フレーム数 3 が
      // 50ms にしかならず、キーボードの打鍵音ひとつで合格してしまう。
      // 100ms × 3 = 約0.3秒の連続した音を要求する。毎フレーム再描画も避けられる。
      let frames = 0
      if (meterRef.current) clearInterval(meterRef.current)
      meterRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        setMicLevel(rms)
        frames = nextMicFrames(frames, isSpeech(rms))
        setMicFrames(frames)
        // 合格したら計測を止める（マイクを掴んだまま回し続けない）
        if (micPassed(frames) && meterRef.current) {
          clearInterval(meterRef.current)
          meterRef.current = null
        }
      }, 100)
      setMicStarted(true)
    } catch {
      setError('マイクを開始できませんでした。アドレスバーのマイクアイコンから「許可」を選んでください。')
    } finally {
      setBusy(null)
    }
  }

  /** ビープ音。TTS が取得できないときでも「音が出るか」だけは確かめられるようにする */
  function playBeep() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    const ctx: AudioContext = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 660
    gain.gain.value = 0.15
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start()
    setTimeout(() => { osc.stop(); ctx.close().catch(() => {}) }, 700)
  }

  async function playTestAudio() {
    setBusy('audio'); setError(null)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: TEST_PHRASE }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = new Audio(url)
      audioElRef.current = audio
      await audio.play()
      setAudioPlayed(true)
    } catch {
      // 本番の読み上げと同じ音は出せなくても、スピーカーが鳴るかは確かめられる。
      // ここで止めると、サーバー側の一時的な不調で参加そのものができなくなる。
      playBeep()
      setAudioFellBack(true)
      setAudioPlayed(true)
    } finally {
      setBusy(null)
    }
  }

  async function openWidget() {
    setBusy('widget'); setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docPiP = (window as any).documentPictureInPicture
      // 前に開いた小窓が残っていると、確認ボタンの無い（あるいは二重の）窓が浮いたままになる
      try { pipRef.current?.close() } catch { /* 既に閉じている */ }
      pipRef.current = null
      const win: Window = await docPiP.requestWindow({ width: 360, height: 240 })
      pipRef.current = win
      win.document.body.style.cssText =
        'margin:0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:14px;height:100%;background:#fff;text-align:center;padding:20px;box-sizing:border-box;'
      const p = win.document.createElement('p')
      p.textContent = 'これがテスト中に使う小窓です。ほかのタブを開いても、この小窓は常に一番手前に表示されます。'
      p.style.cssText = 'margin:0;font-size:13px;line-height:1.7;color:#374151;'
      const btn = win.document.createElement('button')
      btn.textContent = 'この小窓が見えています'
      btn.style.cssText =
        'background:#111827;color:#fff;border:none;border-radius:6px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;'
      btn.addEventListener('click', () => {
        markDone('widget')
        try { win.close() } catch { /* 既に閉じている */ }
        pipRef.current = null
      })
      win.document.body.append(p, btn)
    } catch {
      setError('小窓を開けませんでした。ブラウザの設定でポップアップがブロックされていないか確認して、もう一度お試しください。')
    } finally {
      setBusy(null)
    }
  }

  async function testScreenShare() {
    setBusy('screen'); setError(null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      })
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface
      // 確認できたら即座に止める。ここで録画を続ける必要はない
      stream.getTracks().forEach((t) => t.stop())
      const verdict = screenShareVerdict(surface)
      if (!verdict.ok) { setError(verdict.reason); return }
      markDone('screen')
    } catch {
      setError('画面の共有が開始されませんでした。もう一度試して、「画面全体」を選んで共有してください。')
    } finally {
      setBusy(null)
    }
  }

  function finish() {
    // 遷移前にカメラ・マイクを解放する。許可はこのサイトに残るので、
    // テスト画面では改めて確認を求められない。
    videoStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    videoStreamRef.current = null
    audioStreamRef.current = null
    if (meterRef.current) clearInterval(meterRef.current)
    audioCtxRef.current?.close().catch(() => {})
    onComplete()
  }

  const allDone = steps.every((s) => done.includes(s))
  const verdict = caps ? browserVerdict(caps, steps) : null

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1 tracking-tight">参加前の動作確認</h2>
        <p className="text-gray-500 text-sm leading-relaxed">
          テストの途中で困らないよう、先に {steps.length} 項目だけ確認させてください。
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((id, i) => {
          const state = isDone(id) ? 'done' : current === id ? 'current' : 'locked'
          return (
            <li
              key={id}
              className={`rounded-xl border transition-colors ${
                state === 'current'
                  ? 'bg-white border-gray-900'
                  : state === 'done'
                    ? 'bg-white border-gray-200'
                    : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    state === 'done'
                      ? 'bg-emerald-600 text-white'
                      : state === 'current'
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {state === 'done'
                    ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    : state === 'locked'
                      ? <Lock className="w-3 h-3" strokeWidth={2} />
                      : <span className="text-xs font-semibold">{i + 1}</span>}
                </span>
                <span className={`text-sm font-medium flex items-center gap-1.5 ${state === 'locked' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {STEP_META[id].icon}
                  {STEP_META[id].title}
                </span>
                {state === 'done' && <span className="ml-auto text-xs text-emerald-700">確認できました</span>}
              </div>

              {state === 'current' && (
                <div className="px-4 pb-4 pt-0 border-t border-gray-100 mt-1">
                  <div className="pt-3 space-y-3">
                    {id === 'browser' && (
                      <BrowserStep verdict={verdict} onNext={() => markDone('browser')} />
                    )}

                    {id === 'camera' && (
                      <CameraStep
                        videoRef={videoRef}
                        camOn={camOn}
                        busy={busy === 'camera'}
                        faceStatus={faceStatus}
                        faceCheckAvailable={faceCheckAvailable}
                        graceOver={faceGraceOver}
                        onStart={startCamera}
                        onNext={() => markDone('camera')}
                      />
                    )}

                    {id === 'mic' && (
                      <MicStep
                        started={micStarted}
                        busy={busy === 'mic'}
                        level={micLevel}
                        passed={micPassed(micFrames)}
                        onStart={startMic}
                        onNext={() => markDone('mic')}
                      />
                    )}

                    {id === 'audio' && (
                      <AudioStep
                        played={audioPlayed}
                        fellBack={audioFellBack}
                        busy={busy === 'audio'}
                        onPlay={playTestAudio}
                        onNext={() => markDone('audio')}
                      />
                    )}

                    {id === 'widget' && (
                      <ActionStep
                        description="テスト中は、タスクの文章と操作ボタンを小さな別ウィンドウに表示します。ほかのタブを見ていても、この小窓は常に手前に出ます。"
                        cta="小窓を開いて確認する"
                        busy={busy === 'widget'}
                        onAction={openWidget}
                        note="小窓の中のボタンを押すと、この画面に戻ります。"
                      />
                    )}

                    {id === 'screen' && (
                      <ActionStep
                        description="テストでは画面の操作を録画します。今から共有のダイアログが出るので、「画面全体」を選んで共有してください。ここでは録画せず、選べることだけ確認します。"
                        cta="画面共有を試す"
                        busy={busy === 'screen'}
                        onAction={testScreenShare}
                        note="本番でもう一度、同じダイアログが出ます。"
                      />
                    )}

                    {error && (
                      <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" strokeWidth={2} />
                        <span className="leading-relaxed">{error}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {allDone && (
        <button
          onClick={finish}
          className="mt-5 w-full bg-gray-900 hover:bg-gray-800 text-white px-4 py-2.5 rounded-md text-sm font-medium transition-colors"
        >
          確認できました。次へ進む
        </button>
      )}
    </div>
  )
}

/* ── 各ステップの中身 ───────────────────────────────── */

function NextButton({ disabled, onClick, label = '次へ' }: { disabled: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium transition-colors"
    >
      {label}
    </button>
  )
}

function ActionButton({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-900 hover:bg-gray-900 hover:text-white disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium transition-colors"
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
      {children}
    </button>
  )
}

function BrowserStep({
  verdict,
  onNext,
}: {
  verdict: { ok: boolean; reason: string | null } | null
  onNext: () => void
}) {
  const [copied, setCopied] = useState(false)
  if (!verdict) {
    return <p className="text-xs text-gray-500">確認しています…</p>
  }
  if (verdict.ok) {
    return (
      <>
        <p className="text-xs text-gray-600 leading-relaxed">
          お使いのブラウザで問題なく参加できます。
        </p>
        <NextButton disabled={false} onClick={onNext} />
      </>
    )
  }
  return (
    <>
      <p className="text-xs text-red-700 leading-relaxed">{verdict.reason}</p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <p className="text-[11px] text-gray-500 mb-1.5">このページの URL をコピーして、Chrome で開いてください</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={typeof window !== 'undefined' ? window.location.href : ''}
            aria-label="このページの URL"
            className="flex-1 min-w-0 bg-white border border-gray-300 rounded-md px-2 py-1.5 text-[11px] text-gray-700 focus:outline-none"
          />
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch {
                window.prompt('以下のURLをコピーしてください', window.location.href)
              }
            }}
            className="inline-flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors"
          >
            {copied ? <Check className="w-3 h-3" strokeWidth={2.5} /> : <Copy className="w-3 h-3" strokeWidth={2} />}
            {copied ? 'コピー済み' : 'コピー'}
          </button>
        </div>
      </div>
    </>
  )
}

function CameraStep({
  videoRef,
  camOn,
  busy,
  faceStatus,
  faceCheckAvailable,
  graceOver,
  onStart,
  onNext,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  camOn: boolean
  busy: boolean
  faceStatus: FaceStatus | null
  faceCheckAvailable: boolean
  /** 顔が見つからないまま猶予時間が過ぎたか。逃げ道を出すかの判定に使う */
  graceOver: boolean
  onStart: () => void
  onNext: () => void
}) {
  const { canProceed, bypass } = cameraGate({ camOn, faceCheckAvailable, faceStatus, graceOver })
  const message =
    !camOn ? null
    : !faceCheckAvailable ? '映像が表示されていれば大丈夫です。'
    : faceStatus === 'ok' ? '顔がきちんと写っています。'
    : faceStatus === 'cut_off' ? '顔が画面の端で切れています。カメラの角度か座る位置を調整してください。'
    : faceStatus === 'no_face' ? '顔が見つかりません。明るい場所で、顔がはっきり写るようにしてください。'
    : '映像を確認しています…'

  return (
    <>
      <p className="text-xs text-gray-600 leading-relaxed">
        表情を記録するため、顔が画面に収まっているかを確認します。
      </p>
      {/* 自分の姿は鏡像のほうが位置を直しやすい */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="あなたのカメラ映像"
        className={`w-full rounded-lg bg-gray-900 scale-x-[-1] ${camOn ? 'block' : 'hidden'}`}
        style={{ maxHeight: '180px', objectFit: 'cover' }}
      />
      {message && (
        <p className={`text-xs leading-relaxed ${canProceed ? 'text-emerald-700' : 'text-amber-700'}`}>{message}</p>
      )}
      {!camOn ? (
        <ActionButton busy={busy} onClick={onStart}>カメラを許可する</ActionButton>
      ) : (
        <>
          <NextButton disabled={!canProceed} onClick={onNext} />
          {/* 顔が写っている人にはこの逃げ道を見せない（すぐ出すと直せる人まで押してしまう）。
              暗所などで検出が続けて失敗する人を、直しようのない理由で締め出さないための出口。 */}
          {bypass && (
            <button
              onClick={onNext}
              className="w-full text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 transition-colors"
            >
              うまく認識されないので、このまま進む
            </button>
          )}
        </>
      )}
    </>
  )
}

function MicStep({
  started,
  busy,
  level,
  passed,
  onStart,
  onNext,
}: {
  started: boolean
  busy: boolean
  level: number
  passed: boolean
  onStart: () => void
  onNext: () => void
}) {
  // RMS はごく小さい値なので、そのまま幅にすると動いて見えない
  const pct = Math.min(100, Math.round(level * 1200))
  return (
    <>
      <p className="text-xs text-gray-600 leading-relaxed">
        テスト中は、考えていることを声に出していただきます。マイクが音を拾えているか確認します。
      </p>
      {started && (
        <>
          <p className="text-xs text-gray-700">
            {passed ? '声を確認できました。' : '「あ〜」と声を出してみてください。'}
          </p>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden" role="presentation">
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${passed ? 'bg-emerald-500' : 'bg-gray-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
      {!started
        ? <ActionButton busy={busy} onClick={onStart}>マイクを許可する</ActionButton>
        : <NextButton disabled={!passed} onClick={onNext} />}
    </>
  )
}

function AudioStep({
  played,
  fellBack,
  busy,
  onPlay,
  onNext,
}: {
  played: boolean
  fellBack: boolean
  busy: boolean
  onPlay: () => void
  onNext: () => void
}) {
  return (
    <>
      <p className="text-xs text-gray-600 leading-relaxed">
        テスト中は AI が音声で話しかけます。スピーカーから音が出るか確認します。
        <span className="block text-gray-500">イヤホンなしでの参加をお勧めします。</span>
      </p>
      {played && (
        <>
          {fellBack && (
            <p className="text-[11px] text-gray-500 leading-relaxed">
              音声の読み込みに失敗したため、確認音を鳴らしました。
            </p>
          )}
          <p className="text-xs text-gray-700">聞こえましたか？ 聞こえない場合は音量とスピーカーの設定を確認して、もう一度再生してください。</p>
        </>
      )}
      <ActionButton busy={busy} onClick={onPlay}>
        {played ? 'もう一度再生する' : 'テスト音声を再生する'}
      </ActionButton>
      {played && <NextButton disabled={false} onClick={onNext} label="聞こえました。次へ" />}
    </>
  )
}

function ActionStep({
  description,
  cta,
  busy,
  onAction,
  note,
}: {
  description: string
  cta: string
  busy: boolean
  onAction: () => void
  note?: string
}) {
  return (
    <>
      <p className="text-xs text-gray-600 leading-relaxed">{description}</p>
      <ActionButton busy={busy} onClick={onAction}>{cta}</ActionButton>
      {note && <p className="text-[11px] text-gray-500">{note}</p>}
    </>
  )
}
