'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Monitor, Check, X, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Task {
  text: string
  order: number
}

type WidgetPhase = 'task' | 'done'

function WidgetContent() {
  const searchParams = useSearchParams()
  const sessionId  = searchParams.get('session') ?? ''
  const tasksRaw   = searchParams.get('tasks')   ?? 'W10='
  const initialIdx = parseInt(searchParams.get('current') ?? '0', 10)

  const [tasks, setTasks]                       = useState<Task[]>([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(initialIdx)
  const [widgetPhase, setWidgetPhase]           = useState<WidgetPhase>('task')
  const [doneMessage, setDoneMessage]           = useState('')
  const [isScreenRecording, setIsScreenRecording] = useState(false)
  const [warnNoRecord, setWarnNoRecord]         = useState(false)
  const [cameraError, setCameraError]           = useState(false)

  const channelRef             = useRef<BroadcastChannel | null>(null)
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

  /* ── 画面録画開始（Canvas合成: スクリーン + ウェブカメラPiP） ── */
  async function startScreenRecording() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
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

  /* ── タスク画面 ─────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-900 tracking-tight">UserVoice</span>
        {tasks.length > 0 && (
          <span className="text-gray-500 text-xs">タスク {currentTaskIndex + 1} / {tasks.length}</span>
        )}
      </div>

      {/* ウェブカメラ（16:9 で潰れず表示。取得失敗時はフォールバック） */}
      <div className="relative bg-gray-900 flex-shrink-0 aspect-video">
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
      </div>

      {/* タスク内容（長文はスクロール） */}
      <div className="px-3 py-3 flex-1 min-h-0 overflow-y-auto">
        {currentTask ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-full">
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide font-medium">現在のタスク</p>
            <p className="text-sm text-gray-900 leading-relaxed">{currentTask.text}</p>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-sm text-gray-500">タスクを実行してください</p>
          </div>
        )}
      </div>

      {/* ボタン群 */}
      <div className="px-3 pb-3 space-y-2 flex-shrink-0">
        {/* 画面録画ボタン */}
        {!isScreenRecording ? (
          <button
            onClick={startScreenRecording}
            className="w-full inline-flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border-2 border-red-500 hover:border-red-600 text-red-700 py-2.5 rounded-lg text-sm font-semibold transition-colors animate-pulse hover:animate-none"
          >
            <Monitor className="w-4 h-4" strokeWidth={2} />
            画面録画を開始する
            <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">必須</span>
          </button>
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-red-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            画面録画中
          </div>
        )}

        {/* 録画未開始の警告 */}
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

        {/* タスク結果: 達成 / できなかった */}
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

        {/* セッション終了 */}
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
