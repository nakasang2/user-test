'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Send, GripHorizontal } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  sessionId?: string
  interviewId?: string
}

const PANEL_W = 360
const PANEL_H = 480

export default function FloatingAgentChat({ sessionId, interviewId }: Props) {
  const [open, setOpen] = useState(false)
  // 位置は mount 後に確定（SSR 対策）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'このセッションについて何でも質問してください。\n例：「このユーザーの主な不満点は？」「どんな改善要望がありましたか？」',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // ドラッグ状態（ref で管理して再レンダリングを抑制）
  const drag = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 })

  // 初期位置: 画面右上（右端から少し内側）
  useEffect(() => {
    setPos({
      x: Math.max(0, window.innerWidth - PANEL_W - 24),
      y: 80,
    })
  }, [])

  // メッセージ追加時に一番下へスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // パネルを開いたらインプットにフォーカス
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // ── ドラッグ（Pointer Events でマウス・タッチ両対応）──────────
  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag.current.active) return
    const newX = Math.max(0, Math.min(window.innerWidth - PANEL_W, drag.current.originX + e.clientX - drag.current.startX))
    const newY = Math.max(0, Math.min(window.innerHeight - 48,     drag.current.originY + e.clientY - drag.current.startY))
    setPos({ x: newX, y: newY })
  }, [])

  const onPointerUp = useCallback(() => {
    drag.current.active = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove])

  function onDragStart(e: React.PointerEvent) {
    if (!pos) return
    e.preventDefault()
    drag.current = { active: true, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  // ── メッセージ送信 ────────────────────────────────────
  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated.slice(-10), sessionId, interviewId }),
      })
      const data = await res.json()
      setMessages([...updated, { role: 'assistant', content: data.reply }])
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'エラーが発生しました。' }])
    } finally {
      setLoading(false)
    }
  }

  // ── レンダー ──────────────────────────────────────────
  return (
    <>
      {/* ドラッグ可能フローティングチャットウィンドウ */}
      {open && pos && (
        <div
          className="fixed z-50 flex flex-col bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          style={{ left: pos.x, top: pos.y, width: PANEL_W, height: PANEL_H }}
        >
          {/* ヘッダー（ドラッグハンドル） */}
          <div
            onPointerDown={onDragStart}
            className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white cursor-grab active:cursor-grabbing select-none touch-none flex-shrink-0"
          >
            <div className="flex items-center gap-2 text-gray-700">
              <GripHorizontal className="w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
              <Sparkles className="w-4 h-4" strokeWidth={1.75} />
              <span className="text-sm font-semibold tracking-tight text-gray-900">AI アシスタント</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-700 transition-colors"
              aria-label="閉じる"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          {/* メッセージ一覧 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] text-sm px-3 py-2 rounded-lg whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-gray-900 text-white'
                      : 'bg-white border border-gray-200 text-gray-700'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 px-3 py-2.5 rounded-lg">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 入力欄 */}
          <div className="p-3 border-t border-gray-200 flex gap-2 bg-white flex-shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="質問を入力..."
              className="flex-1 bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 px-3 py-2 rounded-md transition-colors flex-shrink-0"
              aria-label="送信"
            >
              <Send className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* トリガーボタン: 小さいアイコンのみ、右下に固定（パネルを開いている間は非表示） */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-10 h-10 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white rounded-full shadow-lg transition-colors"
          title="AI アシスタント"
        >
          <Sparkles className="w-4 h-4" strokeWidth={1.75} />
        </button>
      )}
    </>
  )
}
