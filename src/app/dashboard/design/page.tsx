'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  Sparkles,
  Send,
  Check,
  Plus,
  X,
  ArrowRight,
  RotateCcw,
  ClipboardList,
  MessageSquare,
  Image as ImageIcon,
  Monitor,
  PartyPopper,
} from 'lucide-react'

type Role = 'user' | 'assistant'
type InterviewType = 'interview' | 'impression' | 'usability'
interface Message { role: Role; content: string }
interface Question { text: string; type: string }
/** AI が生成する質問は自由回答固定なので、保存前にここで形式を選べるようにする */
const Q_TYPES: { value: string; label: string }[] = [
  { value: 'open',   label: '自由回答' },
  { value: 'rating', label: '5段階評価' },
  { value: 'nps',    label: 'NPS（0〜10）' },
]
interface TaskItem  { text: string; order: number; hint?: string }
interface InterviewPlot {
  title: string
  description: string
  questions: Question[]
}

const SESSION_TYPES: { value: InterviewType; icon: React.ReactNode; label: string }[] = [
  { value: 'interview',  icon: <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.75} />, label: 'インタビュー' },
  { value: 'impression', icon: <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.75} />,     label: '印象テスト' },
  { value: 'usability',  icon: <Monitor className="w-3.5 h-3.5" strokeWidth={1.75} />,       label: 'ユーザビリティ' },
]

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: 'こんにちは。インタビュー設計をお手伝いします。\nまず、このインタビューで**何を明らかにしたいですか？** どんな課題や疑問でも構いません。',
}

export default function DesignPage() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [plot, setPlot] = useState<InterviewPlot | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [copiedSavedLink, setCopiedSavedLink] = useState(false)
  const [sessionType, setSessionType]           = useState<InterviewType>('interview')
  const [usabilityMode, setUsabilityMode]       = useState<'prototype' | 'service'>('prototype')
  const [stimulusUrl, setStimulusUrl]           = useState('')
  const [stimulusDuration, setStimulusDuration] = useState(5)
  const [tasks, setTasks]                       = useState<TaskItem[]>([{ text: '', order: 1 }, { text: '', order: 2 }])
  // 詰まった参加者への声かけまでの分数。空欄なら声かけしない
  const [hintDelayMin, setHintDelayMin]         = useState('')
  const [taskBulkMode, setTaskBulkMode]         = useState(false)
  const [taskBulkText, setTaskBulkText]         = useState('')

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
          { role: 'assistant', content: 'プロットを生成しました。右側で確認・編集してください。準備ができたら「インタビューとして保存」を押してください。' },
        ])
      }
    } catch {
      alert('生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  /**
   * まとめ入力のテキスト行に、元のタスクのヒントを引き継ぐ。
   *
   * 引き継ぎは「文言が完全に一致するタスクがちょうど1つだけ」のときに限る。
   *   - 行の位置で引き継ぐと、並べ替えたときに別タスクのヒントが参加者に出る
   *   - 同じ文言のタスクが複数あると、どちらのヒントか決められない
   * 決められないときは引き継がない（空欄として見えるので書き直せる）。
   * 誤ったヒントが参加者に表示されるより、消えているほうが気づける。
   */
  function hintFor(text: string): string | undefined {
    const key = text.trim()
    const matched = tasks.filter((t) => t.text.trim() === key)
    return matched.length === 1 ? matched[0].hint : undefined
  }

  async function saveInterview() {
    if (!plot) return
    // 範囲外のまま送るとサーバー側の英語エラーになり、設計した内容が保存されない
    if (sessionType === 'usability' && hintDelayMin.trim()) {
      const m = Number(hintDelayMin)
      // 整数のみ。フォーム外の保存ボタン（設計ページ）ではブラウザ標準の step 検証が
      // 効かないため、3画面で受理される値が食い違わないよう JS 側でも弾く
      if (!Number.isInteger(m) || m < 1 || m > 30) {
        alert('声かけまでの時間は1〜30分で入力してください（空欄にすると声かけしません）')
        return
      }
    }
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
          usabilityMode:    sessionType === 'usability' ? usabilityMode : undefined,
          stimulusUrl:      (sessionType === 'impression' || sessionType === 'usability') ? (stimulusUrl || undefined) : undefined,
          stimulusDuration: sessionType === 'impression' ? stimulusDuration : undefined,
          tasks:            sessionType === 'usability'
            ? (taskBulkMode
                // まとめ入力中に保存された場合も、文言が一致するタスクのヒントは引き継ぐ
                ? taskBulkText.split('\n').filter((l) => l.trim()).map((text, i) => ({
                    text,
                    order: i + 1,
                    hint: hintFor(text)?.trim() || null,
                  }))
                : tasks.filter((t) => t.text.trim()).map((t, i) => ({
                    text: t.text, order: i + 1, hint: t.hint?.trim() || null,
                  })))
            : undefined,
          // 上の保存前ガードで整数1〜30に確定しているので、そのまま秒に直す
          hintDelaySec:     sessionType === 'usability' && hintDelayMin.trim()
            ? Number(hintDelayMin) * 60
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

  function updateQuestionType(index: number, type: string) {
    if (!plot) return
    const updated = [...plot.questions]
    updated[index] = { ...updated[index], type }
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
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center gap-2.5 shrink-0">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight text-gray-900">UserVoice</Link>
        <span className="text-gray-300">/</span>
        <Link href="/dashboard" className="text-gray-600 text-sm hover:text-gray-900">ダッシュボード</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-900 text-sm">質問設計</span>
      </nav>

      <div className="flex flex-1 overflow-hidden">

        {/* 左：チャット */}
        <div className="flex flex-col w-full lg:w-1/2 border-r border-gray-200">
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-gray-900 text-white rounded-tr-sm'
                    : 'bg-gray-100 text-gray-900 rounded-tl-sm'
                }`}>
                  {m.content.replace(/\*\*(.*?)\*\*/g, '$1')}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0 mr-2">
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-gray-200 p-4 space-y-2 bg-gray-50">
            <form onSubmit={sendMessage} className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力 (Enter で送信)"
                rows={2}
                disabled={loading}
                className="flex-1 bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 resize-none transition-colors disabled:opacity-50"
              />
              <button type="submit" disabled={loading || !input.trim()}
                className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors shrink-0">
                <Send className="w-3.5 h-3.5" strokeWidth={2} />
                送信
              </button>
            </form>
            <button
              onClick={generatePlot}
              disabled={generating || messages.length < 3}
              className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-900 hover:bg-gray-900 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-900 px-4 py-2 rounded-lg text-sm text-gray-900 font-medium transition-colors">
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
              {generating ? '生成中...' : 'この会話からプロットを生成'}
            </button>
          </div>
        </div>

        {/* 右：プレビュー */}
        <div className="hidden lg:flex flex-col w-1/2 overflow-y-auto bg-gray-50">
          {!plot ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
              <div className="w-12 h-12 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
              </div>
              <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
                AIとの会話を通じてインタビューの目的・対象・仮説を整理したら、
                「プロットを生成」を押すと<br />ここにインタビュー構成が表示されます
              </p>
            </div>
          ) : savedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-5">
              <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <PartyPopper className="w-5 h-5 text-emerald-600" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-1 tracking-tight">インタビューを保存しました</h2>
                <p className="text-gray-500 text-sm">下の招待リンクをコピーして参加者に送りましょう</p>
              </div>
              <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-4 text-left">
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-medium">参加者招待リンク</p>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 overflow-hidden text-ellipsis whitespace-nowrap block font-mono">
                    {typeof window !== 'undefined' ? `${window.location.origin}/join/${savedId}` : `/join/${savedId}`}
                  </code>
                  <button
                    onClick={async () => {
                      if (typeof window === 'undefined') return
                      await navigator.clipboard.writeText(`${window.location.origin}/join/${savedId}`)
                      setCopiedSavedLink(true)
                      setTimeout(() => setCopiedSavedLink(false), 2000)
                    }}
                    className="inline-flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0"
                  >
                    {copiedSavedLink ? <><Check className="w-3 h-3" strokeWidth={2.5} /> コピー済み</> : 'コピー'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">参加者が名前を入力するだけでセッションが自動作成されます</p>
              </div>
              <div className="flex gap-2">
                <Link href="/dashboard"
                  className="border border-gray-300 hover:border-gray-400 px-3.5 py-2 rounded-md text-sm text-gray-700 hover:text-gray-900 transition-colors">
                  ダッシュボードへ
                </Link>
                <Link href={`/dashboard/interviews/${savedId}`}
                  className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3.5 py-2 rounded-md text-sm font-medium transition-colors">
                  インタビューを見る
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700">生成されたプロット</h2>
                <span className="text-xs text-gray-400">編集できます</span>
              </div>

              {/* セッションタイプ */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">セッションタイプ</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {SESSION_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => setSessionType(t.value)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs transition-colors ${
                        sessionType === t.value
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                      }`}>
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ユーザビリティテスト: サブタイプ選択 */}
              {sessionType === 'usability' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">テストの種類</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => setUsabilityMode('prototype')}
                      className={`p-3 rounded-md border text-left text-xs transition-colors ${usabilityMode === 'prototype' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'}`}>
                      <div className="font-medium mb-0.5 text-gray-900">プロトタイプ</div>
                      <div className="text-[10px] text-gray-500">Figma / ProtoPie など</div>
                    </button>
                    <button type="button" onClick={() => setUsabilityMode('service')}
                      className={`p-3 rounded-md border text-left text-xs transition-colors ${usabilityMode === 'service' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'}`}>
                      <div className="font-medium mb-0.5 text-gray-900">実際のサービス</div>
                      <div className="text-[10px] text-gray-500">本番サービスのURL</div>
                    </button>
                  </div>
                </div>
              )}

              {/* 印象テスト: 画像URL */}
              {sessionType === 'impression' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">画像URL</label>
                    <input type="url" value={stimulusUrl} onChange={(e) => setStimulusUrl(e.target.value)}
                      placeholder="https://example.com/image.png"
                      className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">表示秒数</label>
                    <input type="number" value={stimulusDuration} onChange={(e) => setStimulusDuration(Number(e.target.value))}
                      min={1} max={60}
                      className="w-20 bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900" />
                  </div>
                </div>
              )}

              {/* ユーザビリティ: URL */}
              {sessionType === 'usability' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                    {usabilityMode === 'prototype' ? 'プロトタイプURL' : 'サービスURL（参考用）'}
                  </label>
                  <input type="url" value={stimulusUrl} onChange={(e) => setStimulusUrl(e.target.value)}
                    placeholder={usabilityMode === 'prototype' ? 'https://www.figma.com/proto/...' : 'https://example.com'}
                    className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500" />
                  <p className="text-xs text-gray-500 mt-1">
                    {usabilityMode === 'prototype' ? 'Figma / ProtoPie などのプロトタイプ共有URLを入力してください' : '実際に操作するサービスのURL（メモ用）'}
                  </p>
                </div>
              )}

              {/* タスクリスト (usability) */}
              {sessionType === 'usability' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs text-gray-500 font-medium uppercase tracking-wide">タスクリスト</label>
                    <button
                      type="button"
                      onClick={() => {
                        if (!taskBulkMode) {
                          setTaskBulkText(tasks.filter((t) => t.text.trim()).map((t) => t.text).join('\n'))
                        } else {
                          const lines = taskBulkText.split('\n').filter((l) => l.trim())
                          setTasks(lines.length > 0
                            ? lines.map((text, i) => ({ text, order: i + 1, hint: hintFor(text) }))
                            : [{ text: '', order: 1 }, { text: '', order: 2 }])
                        }
                        setTaskBulkMode(!taskBulkMode)
                      }}
                      className="text-xs text-gray-700 hover:text-gray-900 underline underline-offset-2 transition-colors"
                    >
                      {taskBulkMode ? '1行ずつ編集' : '複数行でまとめて入力'}
                    </button>
                  </div>
                  {taskBulkMode ? (
                    <div>
                      <textarea
                        value={taskBulkText}
                        onChange={(e) => setTaskBulkText(e.target.value)}
                        placeholder={'タスクを1行ずつ入力してください\n\n例:\nログインする\n商品を検索して詳細ページを開く\nカートに追加して購入する'}
                        rows={6}
                        className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500 resize-none"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        1行 = 1タスク。空行は無視されます。
                        現在 {taskBulkText.split('\n').filter((l) => l.trim()).length} タスク
                        <br />
                        ヒントはここでは編集できません（「1行ずつ編集」に戻すと入力できます）。
                        文言を書き換えた行は、そのヒントが外れます。
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        {tasks.map((t, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex gap-2 items-center">
                              <span className="text-gray-400 text-xs w-4 text-right">{i + 1}</span>
                              <input value={t.text}
                                onChange={(e) => {
                                  const next = [...tasks]
                                  next[i] = { ...next[i], text: e.target.value }
                                  setTasks(next)
                                }}
                                maxLength={2000}
                                placeholder={`タスク ${i + 1}`}
                                className="flex-1 bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500" />
                              {tasks.length > 1 && (
                                <button type="button" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                                  className="text-gray-300 hover:text-red-600 transition-colors p-1">
                                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                                </button>
                              )}
                            </div>
                            {/* 詰まったときに見せるヒント。タスク文言の直下に置いて対応関係を明確にする */}
                            <div className="flex gap-2 items-center">
                              <span className="w-4 flex-shrink-0" aria-hidden="true" />
                              <input value={t.hint ?? ''}
                                onChange={(e) => {
                                  const next = [...tasks]
                                  next[i] = { ...next[i], hint: e.target.value }
                                  setTasks(next)
                                }}
                                maxLength={2000}
                                placeholder="詰まったときのヒント（任意）"
                                aria-label={`タスク ${i + 1} のヒント`}
                                className="flex-1 bg-white border border-dashed border-gray-300 focus:border-gray-900 focus:border-solid focus:outline-none rounded-md px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400" />
                              {tasks.length > 1 && <span className="w-[26px] flex-shrink-0" aria-hidden="true" />}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => setTasks([...tasks, { text: '', order: tasks.length + 1 }])}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900">
                        <Plus className="w-3 h-3" strokeWidth={2} />
                        タスクを追加
                      </button>
                    </>
                  )}

                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-md p-3">
                    <label htmlFor="design-hint-delay" className="block text-xs font-medium text-gray-900 mb-1">
                      詰まった参加者への声かけ
                    </label>
                    <p className="text-xs text-gray-600 leading-relaxed mb-2">
                      指定した時間タスクが進まないと、「うまくいかないときは次に進めます」という案内を出します。
                      上のヒントを書いておくと、そこから見られます。
                      <br />
                      <span className="text-gray-500">空欄にすると声かけは出ません。あとから編集画面で変更できます。</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        id="design-hint-delay"
                        type="number"
                        min={1}
                        max={30}
                        step={1}
                        value={hintDelayMin}
                        onChange={(e) => setHintDelayMin(e.target.value)}
                        placeholder="3"
                        className="w-20 bg-white border border-gray-300 focus:border-gray-900 focus:outline-none rounded-md px-2.5 py-1.5 text-sm"
                      />
                      <span className="text-xs text-gray-600">分後に声かけする（1〜30分）</span>
                    </div>
                  </div>
                </div>
              )}

              {/* タイトル */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">タイトル</label>
                <input
                  type="text"
                  value={plot.title}
                  onChange={(e) => setPlot({ ...plot, title: e.target.value })}
                  className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900"
                />
              </div>

              {/* 説明 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">インタビューの目的・背景</label>
                <textarea
                  value={plot.description}
                  onChange={(e) => setPlot({ ...plot, description: e.target.value })}
                  rows={3}
                  className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 resize-none"
                />
              </div>

              {/* 質問リスト */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">質問（{plot.questions.length}問）</label>
                <div className="space-y-2">
                  {plot.questions.map((q, i) => (
                    <div key={i} className="flex gap-2 items-start group">
                      <span className="text-gray-400 text-xs mt-2.5 w-4 shrink-0 text-right">{i + 1}</span>
                      <div className="flex-1 space-y-1.5">
                        <textarea
                          value={q.text}
                          onChange={(e) => updateQuestion(i, e.target.value)}
                          rows={2}
                          aria-label={`質問 ${i + 1}`}
                          className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 resize-none"
                        />
                        <select
                          value={q.type ?? 'open'}
                          onChange={(e) => updateQuestionType(i, e.target.value)}
                          aria-label={`質問 ${i + 1} の形式`}
                          className="bg-white border border-gray-300 text-xs text-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-gray-900"
                        >
                          {Q_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => removeQuestion(i)}
                        className="text-gray-300 hover:text-red-600 mt-2 transition-colors p-1 opacity-0 group-hover:opacity-100">
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={addQuestion}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1 border border-dashed border-gray-300 hover:border-gray-400 rounded-md py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  <Plus className="w-3 h-3" strokeWidth={2} />
                  質問を追加
                </button>
              </div>

              {/* 保存ボタン */}
              <button
                onClick={saveInterview}
                disabled={saving || !plot.title || plot.questions.length === 0}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-md text-sm font-medium transition-colors">
                {saving ? '保存中...' : (<>インタビューとして保存<ArrowRight className="w-3.5 h-3.5" strokeWidth={2} /></>)}
              </button>

              <button
                onClick={generatePlot}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 px-4 py-2 rounded-md text-xs text-gray-600 hover:text-gray-900 transition-colors">
                <RotateCcw className="w-3 h-3" strokeWidth={2} />
                {generating ? '再生成中...' : '会話から再生成'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
