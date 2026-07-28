'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Monitor, Check, X, AlertTriangle, CheckCircle2, Globe } from 'lucide-react'

interface Task {
  text: string
  order: number
}

type WidgetPhase = 'task' | 'done'

function WidgetContent() {
  const searchParams = useSearchParams()
  const sessionId  = searchParams.get('session')  ?? ''
  const tasksRaw   = searchParams.get('tasks')    ?? 'W10='
  const initialIdx = parseInt(searchParams.get('current') ?? '0', 10)
  const stimulusUrl = searchParams.get('stimulus') ?? ''

  const [tasks, setTasks]                       = useState<Task[]>([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(initialIdx)
  const [widgetPhase, setWidgetPhase]           = useState<WidgetPhase>('task')
  const [doneMessage, setDoneMessage]           = useState('')
  const [isScreenRecording, setIsScreenRecording] = useState(false)
  const [serviceOpened, setServiceOpened]       = useState(false)
  const [warnNoRecord, setWarnNoRecord]         = useState(false)
  const [cameraError, setCameraError]           = useState(false)
  // 顔フレーミング判定: null=判定前 / 'ok'=正常 / 'no_face'=写っていない / 'cut_off'=見切れ
  const [faceStatus, setFaceStatus]             = useState<'ok' | 'no_face' | 'cut_off' | null>(null)

  const channelRef             = useRef<BroadcastChannel | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceApiRef             = useRef<any>(null)
  const webcamVideoRef         = useRef<HTMLVideoElement>(null)
  const webcamStreamRef        = useRef<MediaStream | null>(null)
  const screenMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const screenChunksRef        = useRef<Blob[]>([])
  const screenStreamRef        = useRef<MediaStream | null>(null)
  const animFrameRef           = useRef<number>(0)

  /* ── 初期化 ─────────────────────────────────────────────── */
  useEffect(() => {
    try { setTasks(JSON.parse(decodeURIComponent(atob(tasksRaw)))) } catch { setTasks([]) }

    // BroadcastChannel
    if (sessionId) {
      const channel = new BroadcastChannel(`uservoice-widget-${sessionId}`)
      channelRef.current = channel
      channel.onmessage = (e) => {
        const { type } = e.data
        if (type === 'task_update' && typeof e.data.currentTaskIndex === 'number') {
          setCurrentTaskIndex(e.data.currentTaskIndex)
        } else if (type === 'session_ended') {
          setWidgetPhase('done')
          setDoneMessage('ウィンドウを閉じています...')
          setTimeout(() => window.close(), 1200)
        }
      }
    }

    // ウェブカメラ（表示＋音声。音声は合成録画に載せる）
    initWebcam()

    return () => {
      channelRef.current?.close()
      channelRef.current = null
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      cancelAnimationFrame(animFrameRef.current)
      if (screenMediaRecorderRef.current?.state !== 'inactive') {
        screenMediaRecorderRef.current?.stop()
      }
    }
  }, [sessionId, tasksRaw])

  /* ── ウェブカメラ取得（失敗時はフォールバック表示 + 再試行） ── */
  function initWebcam() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        webcamStreamRef.current = stream
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream
        }
        setCameraError(false)
      })
      .catch(() => { setCameraError(true) })
  }

  /* ── 顔検出モデル（tiny_face_detector のみ）をロード。補助機能なので失敗しても録画は継続 ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof window === 'undefined') return
      try {
        const faceapi = await import('@vladmandic/face-api')
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        if (!cancelled) faceApiRef.current = faceapi
      } catch (err) {
        console.warn('[Widget] 顔検出モデルのロードに失敗（顔フレーミング判定は無効）:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ── 顔フレーミング判定ループ: 数秒ごとに顔の有無と見切れ（画面端に接触）を判定 ── */
  useEffect(() => {
    const interval = setInterval(async () => {
      const faceapi = faceApiRef.current
      const video = webcamVideoRef.current
      if (!faceapi || !video || cameraError || video.readyState < 2 || !video.videoWidth) return
      try {
        const det = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }),
        )
        if (!det) { setFaceStatus('no_face'); return }
        const { x, y, width, height } = det.box
        const vw = video.videoWidth
        const vh = video.videoHeight
        // 端に接していたら「見切れ」。マージンは映像サイズの約1.5%（最低6px）。
        const mx = Math.max(6, vw * 0.015)
        const my = Math.max(6, vh * 0.015)
        const cut = x <= mx || y <= my || (x + width) >= (vw - mx) || (y + height) >= (vh - my)
        setFaceStatus(cut ? 'cut_off' : 'ok')
      } catch {
        // フレームが取れない等は無視
      }
    }, 2500)
    return () => clearInterval(interval)
  }, [cameraError])

  /* ── 画面録画開始（Canvas合成: スクリーン + ウェブカメラPiP） ── */
  async function startScreenRecording() {
    try {
      // displaySurface:'monitor' で「画面全体」をダイアログの既定に寄せる。
      // どのタブを操作してもサービスが確実に録画対象に含まれ、参加者がタブを選び間違えない。
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false })
      screenStreamRef.current = screenStream
      screenChunksRef.current = []

      // スクリーン用 offscreen video を作成・再生
      const screenVid = document.createElement('video')
      screenVid.srcObject = screenStream
      screenVid.muted = true
      await new Promise<void>((resolve) => {
        screenVid.onloadedmetadata = () => {
          screenVid.play().then(resolve).catch(resolve)
        }
      })

      // Canvas サイズはスクリーン解像度（上限 1920×1080）
      const W = Math.min(screenVid.videoWidth  || 1280, 1920)
      const H = Math.min(screenVid.videoHeight || 720,  1080)
      const canvas = document.createElement('canvas')
      canvas.width  = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!

      // ウェブカメラ PiP 幅（右下に配置）。高さは実映像のアスペクト比から毎フレーム算出し、
      // 縦横比の潰れ（16:9 を 4:3 枠に押し込む等）を防ぐ。
      const pipW = Math.round(W * 0.22)

      const webcamVid = webcamVideoRef.current

      // 合成描画ループ
      function draw() {
        ctx.drawImage(screenVid, 0, 0, W, H)

        if (webcamVid && webcamVid.readyState >= 2 && webcamVid.videoWidth) {
          // 実際のカメラのアスペクト比で高さを決める（潰れ防止）
          const ratio = webcamVid.videoHeight / webcamVid.videoWidth || 0.75
          const pipH = Math.round(pipW * ratio)
          const pipX = W - pipW - 16
          const pipY = H - pipH - 16
          // クリップしてから左右反転（鏡映し）で描画
          ctx.save()
          ctx.beginPath()
          ctx.rect(pipX, pipY, pipW, pipH)
          ctx.clip()
          ctx.translate(pipX + pipW, pipY)
          ctx.scale(-1, 1)
          ctx.drawImage(webcamVid, 0, 0, pipW, pipH)
          ctx.restore()
          // 白枠
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'
          ctx.lineWidth = 2
          ctx.strokeRect(pipX, pipY, pipW, pipH)
        }

        animFrameRef.current = requestAnimationFrame(draw)
      }
      draw()

      // Canvas ストリームを録画
      const canvasStream = canvas.captureStream(25)
      // マイク音声（ウェブカメラ取得時の音声トラック）を合成に追加
      const micTrack = webcamStreamRef.current?.getAudioTracks?.()[0]
      if (micTrack) canvasStream.addTrack(micTrack)
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {})
      recorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunksRef.current.push(e.data) }
      recorder.start(1000)
      screenMediaRecorderRef.current = recorder
      setIsScreenRecording(true)

      // メインページへ録画開始を通知
      channelRef.current?.postMessage({ type: 'recording_started' })

      // 画面共有が終了されたら描画ループも止める
      screenStream.getVideoTracks()[0].onended = () => {
        cancelAnimationFrame(animFrameRef.current)
        setIsScreenRecording(false)
        screenStreamRef.current = null
      }
    } catch {
      // キャンセルされた場合は何もしない
    }
  }

  /* ── 録画停止 → blob をメインページへ送信 ─────────────────── */
  function stopAndSendRecording(): Promise<void> {
    return new Promise((resolve) => {
      // 合成描画ループを停止
      cancelAnimationFrame(animFrameRef.current)
      const recorder = screenMediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        // すでに停止済み（画面共有が先に終了した場合など）でも chunks があれば送信
        const blob = new Blob(screenChunksRef.current, { type: recorder?.mimeType || 'video/webm' })
        if (blob.size > 0) channelRef.current?.postMessage({ type: 'screen_recording_blob', blob })
        screenStreamRef.current?.getTracks().forEach((t) => t.stop())
        resolve()
        return
      }
      recorder.onstop = () => {
        const blob = new Blob(screenChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        if (blob.size > 0) {
          channelRef.current?.postMessage({ type: 'screen_recording_blob', blob })
        }
        screenStreamRef.current?.getTracks().forEach((t) => t.stop())
        resolve()
      }
      recorder.stop()
    })
  }

  /* ── インタビューページへフォーカスを戻す ─────────────────── */
  function focusInterviewPage() {
    if (window.opener && !window.opener.closed) {
      window.opener.focus(); return
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipOpener = (window.parent as any)?.opener
      if (pipOpener && !pipOpener.closed) pipOpener.focus()
    } catch { /* cross-origin guard */ }
  }

  const isLastTask = currentTaskIndex + 1 >= tasks.length
  const pendingOutcomeRef = useRef<'completed' | 'gave_up'>('completed')

  /* ── タスク結果を記録して次へ（達成 / 断念）。最後なら録画を止めて質問へ ── */
  async function handleOutcome(outcome: 'completed' | 'gave_up') {
    if (!isLastTask) {
      // 途中のタスク: 結果だけ送って次へ（録画は継続）
      channelRef.current?.postMessage({ type: 'task_outcome', outcome })
      setCurrentTaskIndex((i) => Math.min(i + 1, tasks.length - 1))
      return
    }
    // 最後のタスク: 録画必須（未開始なら警告）
    if (!isScreenRecording && screenChunksRef.current.length === 0) {
      pendingOutcomeRef.current = outcome
      setWarnNoRecord(true)
      return
    }
    await finalize(outcome)
  }

  async function finalize(outcome: 'completed' | 'gave_up') {
    setWarnNoRecord(false)
    focusInterviewPage()            // ① フォーカス（ユーザージェスチャー文脈）
    await stopAndSendRecording()    // ② 録画停止 & blob 送信
    channelRef.current?.postMessage({ type: 'task_outcome', outcome })
    setDoneMessage('インタビューページに戻ります...')
    setWidgetPhase('done')
  }

  /* ── セッション終了 ───────────────────────────────────────── */
  async function endSession() {
    focusInterviewPage()
    await stopAndSendRecording()
    channelRef.current?.postMessage({ type: 'end_session' })
    setDoneMessage('セッションを終了します...')
    setWidgetPhase('done')
    setTimeout(() => window.close(), 800)
  }

  /* ── 完了画面 ─────────────────────────────────────────────── */
  if (widgetPhase === 'done') {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-gray-600">{doneMessage}</p>
        </div>
      </div>
    )
  }

  const currentTask = tasks[currentTaskIndex]
  // 事前手続き（録画開始 →（サービスURLがあれば）サービスを開く）が完了したか。
  // 完了して初めてタスク文言と結果ボタンを表示し、準備中は隠して混乱を防ぐ。
  const readyForTask = isScreenRecording && (serviceOpened || !stimulusUrl)

  /* ── タスク画面 ─────────────────────────────────────────────── */
  // 注: Document PiP の iframe 内では 100vh 等の viewport 単位が実際の窓より大きく評価され、
  //     min-h-screen だと巨大な余白＋スクロールが出る。ここでは vh/flex 高さ配分を使わず、
  //     ヘッダー→カメラ→タスク→ボタンを自然な縦積み（block flow）で並べて崩れを防ぐ。
  return (
    <div className="bg-white text-gray-900">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-900 tracking-tight">UserVoice</span>
        {tasks.length > 0 && (
          <span className="text-gray-500 text-xs">タスク {currentTaskIndex + 1} / {tasks.length}</span>
        )}
      </div>

      {/* ウェブカメラ（16:9 で潰れず表示。取得失敗時はフォールバック） */}
      <div className="relative bg-gray-900 aspect-video">
        <video
          ref={webcamVideoRef}
          autoPlay
          muted
          playsInline
          aria-label="あなたのカメラ映像"
          className={`w-full h-full object-cover scale-x-[-1] ${cameraError ? 'hidden' : ''}`}
        />
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="w-5 h-5 text-gray-300" strokeWidth={1.75} />
            <p className="text-[11px] text-gray-200 leading-relaxed">カメラを利用できません。<br />ブラウザで許可されているかご確認ください。</p>
            <button
              onClick={initWebcam}
              className="mt-0.5 text-[11px] bg-white/90 hover:bg-white text-gray-900 px-2.5 py-1 rounded-md font-medium transition-colors"
            >
              再試行
            </button>
          </div>
        )}
        {isScreenRecording && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-white/95 border border-red-200 px-2 py-1 rounded-md shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-red-600 font-semibold tracking-wide">REC</span>
          </div>
        )}
        {/* 顔フレーミング警告（カメラ下端にオーバーレイ）。見切れ・未検出のときだけ出す */}
        {!cameraError && (faceStatus === 'no_face' || faceStatus === 'cut_off') && (
          <div className="absolute bottom-0 inset-x-0 flex items-center gap-1.5 bg-amber-500/95 text-white px-2.5 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.25} />
            <span className="text-[11px] font-medium leading-snug">
              {faceStatus === 'no_face'
                ? '顔が写っていません。カメラに顔が入るように調整してください'
                : '顔が見切れています。中央に顔が来るように位置を調整してください'}
            </span>
          </div>
        )}
      </div>

      {/* タスク内容（上詰め。長文はここだけスクロールし、下のボタンは常に見える。vh非依存で px 上限）。
          事前手続き（録画・サービス起動）が終わるまでは、タスク文言ではなく準備の案内を出す。 */}
      <div className="px-3 py-3 max-h-64 overflow-y-auto">
        {readyForTask ? (
          currentTask ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide font-medium">現在のタスク</p>
              <p className="text-sm text-gray-900 leading-relaxed">{currentTask.text}</p>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm text-gray-500">タスクを実行してください</p>
            </div>
          )
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide font-medium">準備</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              下のボタンで準備を進めてください{stimulusUrl ? '（画面録画 → サービスを開く）' : '（画面録画）'}。準備ができると、ここにタスクが表示されます。
            </p>
          </div>
        )}
      </div>

      {/* ボタン群。操作はこの小窓に集約し、黒い主 CTA が常に 1 つだけになるよう段階表示する。
          録画 →（録画後に）サービスを開く →（開いた後に）達成/できなかった/終了、と主役が入れ替わる。 */}
      <div className="px-3 pb-3 pt-1 space-y-2">
        {/* 録画状態: 未開始なら開始ボタン、開始後は「画面録画中」インジケータ（常に単一表示） */}
        {!isScreenRecording ? (
          <div className="space-y-1">
            <button
              onClick={startScreenRecording}
              className="w-full inline-flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border-2 border-red-500 hover:border-red-600 text-red-700 py-2.5 rounded-lg text-sm font-semibold transition-colors animate-pulse hover:animate-none"
            >
              <Monitor className="w-4 h-4" strokeWidth={2} />
              画面録画を開始する
              <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">必須</span>
            </button>
            <p className="text-[10px] text-gray-500 text-center leading-snug">
              表示されるダイアログで<span className="font-semibold text-gray-700">「画面全体」</span>を選んで共有してください
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-red-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            画面録画中
          </div>
        )}

        {/* サービスを開く: 録画開始後・未オープン時のみ主 CTA として表示。押したら状態を進める */}
        {isScreenRecording && stimulusUrl && !serviceOpened && (
          <div className="space-y-1">
            <a
              href={stimulusUrl}
              target="uservoice-service"
              rel="noopener noreferrer"
              onClick={() => { setServiceOpened(true); channelRef.current?.postMessage({ type: 'service_opened' }) }}
              className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
            >
              <Globe className="w-4 h-4" strokeWidth={2} />
              サービスを開く（新しいタブ）
            </a>
            <p className="text-[10px] text-gray-500 text-center leading-snug">
              新しいタブでサービスが開きます。操作を試してください
            </p>
          </div>
        )}

        {/* 結果ボタン: サービスを開いた後（サービス URL 未設定なら録画開始後）に初めて表示 */}
        {isScreenRecording && (serviceOpened || !stimulusUrl) && (
          <>
            {stimulusUrl && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                <span>サービスを開いています</span>
                <a
                  href={stimulusUrl}
                  target="uservoice-service"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-800 underline underline-offset-2"
                >
                  開き直す
                </a>
              </div>
            )}

            {/* 録画未開始の警告（録画が途中で止まった等の保険） */}
            {warnNoRecord && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 space-y-2">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                  画面録画が開始されていません
                </p>
                <p className="text-amber-800/80">録画なしでタスクを完了しますか？</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setWarnNoRecord(false)}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-md text-xs font-medium transition-colors"
                  >
                    録画してから完了
                  </button>
                  <button
                    onClick={() => finalize(pendingOutcomeRef.current)}
                    className="flex-1 bg-white border border-amber-300 hover:border-amber-500 text-amber-800 py-1.5 rounded-md text-xs transition-colors"
                  >
                    このまま完了
                  </button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-gray-500 text-center leading-snug pt-1">
              操作が終わったら押してください
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleOutcome('completed')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 active:bg-black text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} />
                達成して{isLastTask ? '質問へ' : '次へ'}
              </button>
              <button
                onClick={() => handleOutcome('gave_up')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                できなかった
              </button>
            </div>
          </>
        )}

        {/* セッション終了は常に押せる脱出口として最下部に常時表示（録画を始めない参加者が
            中断できず詰むのを防ぐ）。控えめな枠線ボタンなので黒い主 CTA とは競合しない。 */}
        <button
          onClick={endSession}
          className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 py-2 rounded-lg text-xs transition-colors"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
          セッションを終了
        </button>
      </div>
    </div>
  )
}

export default function WidgetPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    }>
      <WidgetContent />
    </Suspense>
  )
}
