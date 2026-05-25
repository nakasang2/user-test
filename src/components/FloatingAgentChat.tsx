'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Sparkles } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  sessionId?: string
  interviewId?: string
}

export default function FloatingAgentChat({ sessionId, interviewId }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'このセッションについて何でも質問してください。\n例：「このユーザーの主な不満点は？」「どんな改善要望がありましたか？」',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) {
      // パネルが開いたらインプットにフォーカス
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

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
        body: JSON.stringify({
          messages: updated.slice(-10),
          sessionId,
          interviewId,
        }),
      })
      const data = await res.json()
      setMessages([...updated, { role: 'assistant', content: data.reply }])
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'エラーが発生しました。' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* チャットパネル */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-[340px] flex flex-col bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ height: '460px' }}>
          {/* ヘッダー */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-gray-700" strokeWidth={1.75} />
              <span className="text-sm font-semibold tracking-tight text-gray-900">AI アシスタント</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-gray-900 transition-colors"
              aria-label="閉じる"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          {/* メッセージ一覧 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] text-sm px-3 py-2 rounded-md whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-200 text-gray-700'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 px-3 py-2.5 rounded-md">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 入力欄 */}
          <div className="p-3 border-t border-gray-200 flex gap-2 bg-white">
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
              className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 px-3 py-2 rounded-md text-sm transition-colors flex-shrink-0"
            >
              送信
            </button>
          </div>
        </div>
      )}

      {/* フローティングボタン */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-xl font-medium text-sm transition-colors ${
          open
            ? 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
            : 'bg-gray-900 hover:bg-gray-800 text-white'
        }`}
      >
        {open ? (
          <>
            <X className="w-4 h-4" strokeWidth={2} />
            閉じる
          </>
        ) : (
          <>
            <MessageCircle className="w-4 h-4" strokeWidth={2} />
            AI に質問
          </>
        )}
      </button>
    </>
  )
}
