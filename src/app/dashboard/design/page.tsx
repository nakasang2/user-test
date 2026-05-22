'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

type Role = 'user' | 'assistant'
type InterviewType = 'interview' | 'impression' | 'prototype' | 'usability'
interface Message { role: Role; content: string }
interface Question { text: string; type: string }
interface TaskItem  { text: string; order: number }
interface InterviewPlot {
  title: string
  description: string
  questions: Question[]
}

const SESSION_TYPES: { value: InterviewType; icon: string; label: string }[] = [
  { value: 'interview',  icon: '📝', label: 'インタビュー' },
  { value: 'impression', icon: '🖼️', label: '印象テスト' },
  { value: 'prototype',  icon: '🎨', label: 'プロトタイプ' },
  { value: 'usability',  icon: '🖥️', label: 'ユーザビリティ' },
]

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: 'こんにちは！インタビュー設計をお手伝いします。\nまず、このインタビューで**何を明らかにしたいですか？** どんな課題や疑問でも構いません。',
}

export default function DesignPage() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [plot, setPlot] = useState<InterviewPlot | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  // セッションタイプ設定
  const [sessionType, setSessionType]           = useState<InterviewType>('interview')
  const [stimulusUrl, setStimulusUrl]           = useState('')
  const [stimulusDuration, setStimulusDuration] = useState(5)
  const [tasks, setTasks]                       = useState<TaskItem[]>([{ text: '', order: 1 }, { text: '', order: 2 }])

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'エラーが発生しました。もう一度お試しください。' }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function generatePlot() {
    setGenerating(true)
    try {
      const res = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, action: 'generate' }),
      })
      const data = await res.json()
      if (data.interview) {
        setPlot(data.interview)
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'プロットを生成しました！右側で確認・編集してください。準備ができたら「インタビューとして保存」を押してください。' },
        ])
      }
    } catch {
      alert('生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  async function saveInterview() {
    if (!plot) return
    setSaving(true)
    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:            plot.title,
          description:      plot.description,
          questions:        plot.questions,
          type:             sessionType,
          stimulusUrl:      (sessionType === 'impression' || sessionType === 'prototype') ? (stimulusUrl || undefined) : undefined,
          stimulusDuration: sessionType === 'impression' ? stimulusDuration : undefined,
          tasks:            (sessionType === 'prototype' || sessionType === 'usability')
            ? tasks.filter((t) => t.text.trim()).map((t, i) => ({ text: t.text, order: i + 1 }))
            : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'エラーが発生しました'); return }
      setSavedId(data.id)
    } finally {
      setSaving(false)
    }
  }

  function updateQuestion(index: number, text: string) {
    if (!plot) return
    const updated = [...plot.questions]
    updated[index] = { ...updated[index], text }
    setPlot({ ...plot, questions: updated })
  }

  function addQuestion() {
    if (!plot) return
    setPlot({ ...plot, questions: [...plot.questions, { text: '', type: 'open' }] })
  }

  function removeQuestion(index: number) {
    if (!plot) return
    setPlot({ ...plot, questions: plot.questions.filter((_, i) => i !== index) })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ナビ */}
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-3 shrink-0">
        <Link href="/dashboard" className="text-indigo-400 font-bold text-lg">UserVoice</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 text-sm">質問設計</span>
      </nav>

      {/* メインコンテンツ */}
      <div className="flex flex-1 overflow-hidden">

        {/* 左：チャット */}
        <div className="flex flex-col w-full lg:w-1/2 border-r border-gray-800">
          {/* チャット履歴 */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mr-2 mt-0.5">
                    AI
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-gray-800 text-gray-100 rounded-tl-sm'
                }`}>
                  {m.content.replace(/\*\*(.*?)\*\*/g, '$1')}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mr-2">
                  AI
                </div>
                <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 入力エリア */}
          <div className="border-t border-gray-800 p-4 space-y-2">
            <form onSubmit={sendMessage} className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力… (Enter で送信)"
                rows={2}
                disabled={loading}
                className="flex-1 bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 resize-none transition-colors disabled:opacity-50"
              />
              <button type="submit" disabled={loading || !input.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0">
                送信
              </button>
            </form>
            <button
              onClick={generatePlot}
              disabled={generating || messages.length < 3}
              className="w-full border border-indigo-700 hover:border-indigo-500 hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-sm text-indigo-400 font-medium transition-colors">
              {generating ? '✨ 生成中...' : '✨ この会話からプロットを生成'}
            </button>
          </div>
        </div>

        {/* 右：プレビュー */}
        <div className="hidden lg:flex flex-col w-1/2 overflow-y-auto">
          {!plot ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
              <div className="text-5xl">📋</div>
              <p className="text-gray-500 text-sm leading-relaxed">
                AIとの会話を通じてインタビューの目的・対象・仮説を整理したら、<br />
                「プロットを生成」ボタンを押すと<br />
                ここにインタビュー構成が表示されます
              </p>
            </div>
          ) : savedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
              <div className="text-5xl">🎉</div>
              <h2 className="text-lg font-semibold text-white">インタビューを保存しました</h2>
              <p className="text-gray-400 text-sm">招待リンクを発行してユーザーを招待できます</p>
              <div className="flex gap-3">
                <Link href="/dashboard"
                  className="border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
                  ダッシュボードへ
                </Link>
                <Link href={`/dashboard/interviews/${savedId}`}
                  className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  インタビューを見る →
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-400">生成されたプロット</h2>
                <span className="text-xs text-gray-600">編集できます</span>
              </div>

              {/* セッションタイプ */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">セッションタイプ</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {SESSION_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => setSessionType(t.value)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                        sessionType === t.value
                          ? 'border-indigo-500 bg-indigo-900/30 text-white'
                          : 'border-gray-700 text-gray-500 hover:border-gray-600'
                      }`}>
                      <span>{t.icon}</span>{t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 印象テスト: 画像URL */}
              {sessionType === 'impression' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">画像URL</label>
                    <input type="url" value={stimulusUrl} onChange={(e) => setStimulusUrl(e.target.value)}
                      placeholder="https://example.com/image.png"
                      className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">表示秒数</label>
                    <input type="number" value={stimulusDuration} onChange={(e) => setStimulusDuration(Number(e.target.value))}
                      min={1} max={60}
                      className="w-20 bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                </div>
              )}

              {/* プロトタイプ: Figma URL */}
              {sessionType === 'prototype' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Figma プロトタイプURL</label>
                  <input type="url" value={stimulusUrl} onChange={(e) => setStimulusUrl(e.target.value)}
                    placeholder="https://www.figma.com/proto/..."
                    className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                </div>
              )}

              {/* タスクリスト (prototype / usability) */}
              {(sessionType === 'prototype' || sessionType === 'usability') && (
                <div>
                  <label className="block text-xs text-gray-500 mb-2">タスクリスト</label>
                  <div className="space-y-1.5">
                    {tasks.map((t, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="text-gray-600 text-xs w-4 text-right">{i + 1}</span>
                        <input value={t.text}
                          onChange={(e) => {
                            const next = [...tasks]
                            next[i] = { ...next[i], text: e.target.value }
                            setTasks(next)
                          }}
                          placeholder={`タスク ${i + 1}`}
                          className="flex-1 bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                        {tasks.length > 1 && (
                          <button type="button" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                            className="text-gray-700 hover:text-red-400 text-xs transition-colors">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setTasks([...tasks, { text: '', order: tasks.length + 1 }])}
                    className="mt-1.5 text-xs text-indigo-400 hover:text-indigo-300">+ タスクを追加</button>
                </div>
              )}

              {/* タイトル */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">タイトル</label>
                <input
                  type="text"
                  value={plot.title}
                  onChange={(e) => setPlot({ ...plot, title: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>

              {/* 説明 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">インタビューの目的・背景</label>
                <textarea
                  value={plot.description}
                  onChange={(e) => setPlot({ ...plot, description: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white resize-none"
                />
              </div>

              {/* 質問リスト */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">質問（{plot.questions.length}問）</label>
                <div className="space-y-2">
                  {plot.questions.map((q, i) => (
                    <div key={i} className="flex gap-2 items-start group">
                      <span className="text-gray-600 text-xs mt-2.5 w-4 shrink-0 text-right">{i + 1}</span>
                      <textarea
                        value={q.text}
                        onChange={(e) => updateQuestion(i, e.target.value)}
                        rows={2}
                        className="flex-1 bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-white resize-none"
                      />
                      <button
                        onClick={() => removeQuestion(i)}
                        className="text-gray-700 hover:text-red-400 text-xs mt-2 transition-colors opacity-0 group-hover:opacity-100">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={addQuestion}
                  className="mt-2 w-full border border-dashed border-gray-700 hover:border-gray-500 rounded-lg py-2 text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  + 質問を追加
                </button>
              </div>

              {/* 保存ボタン */}
              <button
                onClick={saveInterview}
                disabled={saving || !plot.title || plot.questions.length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-xl text-sm font-semibold transition-colors">
                {saving ? '保存中...' : 'インタビューとして保存 →'}
              </button>

              <button
                onClick={generatePlot}
                disabled={generating}
                className="w-full border border-gray-700 hover:border-gray-600 px-4 py-2 rounded-xl text-xs text-gray-500 hover:text-gray-400 transition-colors">
                {generating ? '再生成中...' : '↺ 会話から再生成'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
