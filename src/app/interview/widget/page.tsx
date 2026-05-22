'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

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

    // ウェブカメラ（表示のみ、録音なし）
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        webcamStreamRef.current = stream
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream
        }
      })
      .catch(() => { /* カメラ未使用でも継続 */ })

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

      // ウェブカメラ PiP サイズ（右下に配置）
      const pipW = Math.round(W * 0.22)
      const pipH = Math.round(pipW * 0.75) // 4:3
      const pipX = W - pipW - 16
      const pipY = H - pipH - 16

      const webcamVid = webcamVideoRef.current

      // 合成描画ループ
      function draw() {
        ctx.drawImage(screenVid, 0, 0, W, H)

        if (webcamVid && webcamVid.readyState >= 2) {
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
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
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
      if (!recorder || recorder.state === 'inactive') { resolve(); return }
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

  /* ── タスク完了 ───────────────────────────────────────────── */
  async function taskComplete() {
    focusInterviewPage()            // ① フォーカス（ユーザージェスチャー文脈）
    await stopAndSendRecording()    // ② 録画停止 & blob 送信
    channelRef.current?.postMessage({ type: 'task_complete' })
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
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-sm text-gray-300">{doneMessage}</p>
        </div>
      </div>
    )
  }

  const currentTask = tasks[currentTaskIndex]

  /* ── タスク画面 ─────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-indigo-400 text-xs font-bold tracking-wide">UserVoice</span>
        {tasks.length > 0 && (
          <span className="text-gray-600 text-xs">タスク {currentTaskIndex + 1} / {tasks.length}</span>
        )}
      </div>

      {/* ウェブカメラ */}
      <div className="relative bg-black flex-shrink-0" style={{ height: 140 }}>
        <video
          ref={webcamVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover scale-x-[-1]"
        />
        {/* 録画インジケーター */}
        {isScreenRecording && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-red-400 font-medium">REC</span>
          </div>
        )}
      </div>

      {/* タスク内容 */}
      <div className="px-3 py-3 flex-1">
        {currentTask ? (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 h-full">
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">現在のタスク</p>
            <p className="text-sm text-white leading-relaxed">{currentTask.text}</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">タスクを実行してください</p>
          </div>
        )}
      </div>

      {/* ボタン群 */}
      <div className="px-3 pb-3 space-y-2 flex-shrink-0">
        {/* 画面録画ボタン */}
        {!isScreenRecording ? (
          <button
            onClick={startScreenRecording}
            className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-red-500 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            🖥️ 画面録画を開始する
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            画面録画中
          </div>
        )}

        {/* タスク完了 */}
        <button
          onClick={taskComplete}
          className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 py-3 rounded-xl text-sm font-semibold transition-colors"
        >
          ✅ タスク完了 → 質問へ
        </button>

        {/* セッション終了 */}
        <button
          onClick={endSession}
          className="w-full border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white py-2 rounded-xl text-xs transition-colors"
        >
          セッションを終了する
        </button>
      </div>
    </div>
  )
}

export default function WidgetPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-600 text-sm">読み込み中...</div>
      </div>
    }>
      <WidgetContent />
    </Suspense>
  )
}
