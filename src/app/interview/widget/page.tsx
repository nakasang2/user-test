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
  const tasksRaw   = searchParams.get('tasks')   ?? 'W10=' // base64 '[]'
  const initialIdx = parseInt(searchParams.get('current') ?? '0', 10)

  const [tasks, setTasks]                   = useState<Task[]>([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(initialIdx)
  const [widgetPhase, setWidgetPhase]       = useState<WidgetPhase>('task')
  const [doneMessage, setDoneMessage]       = useState('')
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    try { setTasks(JSON.parse(atob(tasksRaw))) } catch { setTasks([]) }

    if (!sessionId) return
    const channel = new BroadcastChannel(`uservoice-widget-${sessionId}`)
    channelRef.current = channel

    channel.onmessage = (e) => {
      const { type } = e.data
      if (type === 'task_update' && typeof e.data.currentTaskIndex === 'number') {
        setCurrentTaskIndex(e.data.currentTaskIndex)
      } else if (type === 'session_ended') {
        setDoneMessage('インタビューに戻ります...')
        setWidgetPhase('done')
        setTimeout(() => window.close(), 1500)
      }
    }

    return () => { channel.close(); channelRef.current = null }
  }, [sessionId, tasksRaw])

  function taskComplete() {
    channelRef.current?.postMessage({ type: 'task_complete' })
    setDoneMessage('質問フェーズへ移行します...')
    setWidgetPhase('done')
  }

  function endSession() {
    channelRef.current?.postMessage({ type: 'end_session' })
    setDoneMessage('セッションを終了します...')
    setWidgetPhase('done')
    setTimeout(() => window.close(), 800)
  }

  /* ── 完了画面 ─────────────────────────────────────────── */
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

  /* ── タスク画面 ─────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-4 select-none">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-800">
        <span className="text-indigo-400 text-xs font-bold tracking-wide">UserVoice</span>
        {tasks.length > 0 && (
          <span className="text-gray-600 text-xs">
            タスク {currentTaskIndex + 1} / {tasks.length}
          </span>
        )}
      </div>

      {/* タスク内容 */}
      <div className="flex-1 mb-4">
        {currentTask ? (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3">
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">現在のタスク</p>
            <p className="text-sm text-white leading-relaxed">{currentTask.text}</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">タスクを実行してください</p>
          </div>
        )}
      </div>

      {/* ボタン */}
      <div className="space-y-2">
        <button
          onClick={taskComplete}
          className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 py-3 rounded-xl text-sm font-semibold transition-colors"
        >
          ✅ タスク完了 → 質問へ
        </button>
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
