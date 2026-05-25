'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  sessionId?: string
  interviewId?: string
}

export default function AgentChat({ sessionId, interviewId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: sessionId
        ? 'このセッションについて何でも質問してください。例：「このユーザーの主な不満点は？」'
        : 'インタビューデータについて質問してください。例：「全参加者の共通の課題は？」',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.slice(-10),
          sessionId,
          interviewId,
        }),
      })
      const data = await res.json()
      setMessages([...updatedMessages, { role: 'assistant', content: data.reply }])
    } catch {
      setMessages([...updatedMessages, { role: 'assistant', content: 'エラーが発生しました。' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden h-96">
      <div className="p-3 border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-gray-500" strokeWidth={1.75} />
        AI アシスタント
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] text-sm px-3 py-2 rounded-md ${
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
            <div className="bg-white border border-gray-200 px-3 py-2 rounded-md">
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
      <div className="p-3 border-t border-gray-200 flex gap-2 bg-white">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="質問を入力..."
          className="flex-1 bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none"
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 px-3 py-2 rounded-md text-sm transition-colors"
        >
          送信
        </button>
      </div>
    </div>
  )
}
