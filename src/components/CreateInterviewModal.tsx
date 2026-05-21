'use client'

import { useState } from 'react'

interface QuestionItem {
  text: string
  type: 'open' | 'rating' | 'nps'
}

interface Props {
  onClose: () => void
  onCreated: () => void
}

const TYPE_LABELS = { open: '自由回答', rating: '5段階評価', nps: 'NPS (0-10)' }
const TYPE_COLORS = {
  open: 'bg-gray-700 text-gray-300',
  rating: 'bg-blue-900/60 text-blue-300',
  nps: 'bg-green-900/60 text-green-300',
}

export default function CreateInterviewModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<QuestionItem[]>([
    { text: '', type: 'open' },
    { text: '', type: 'open' },
    { text: '', type: 'open' },
  ])
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || undefined,
          questions: autoGenerate
            ? []
            : questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text, type: q.type })),
          autoGenerate,
          topic: autoGenerate ? topic : undefined,
        }),
      })
      onCreated()
    } finally {
      setLoading(false)
    }
  }

  function updateQuestion(i: number, patch: Partial<QuestionItem>) {
    const next = [...questions]
    next[i] = { ...next[i], ...patch }
    setQuestions(next)
  }

  function cycleType(i: number) {
    const order: QuestionItem['type'][] = ['open', 'rating', 'nps']
    const current = questions[i].type
    const next = order[(order.indexOf(current) + 1) % order.length]
    updateQuestion(i, { type: next })
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold">インタビューテンプレートを作成</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">タイトル *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="例：新機能のユーザビリティテスト"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="インタビューの目的や対象者を記述..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <span className="text-sm text-gray-300">AI で質問を自動生成</span>
          </label>

          {autoGenerate ? (
            <div>
              <label className="block text-sm text-gray-400 mb-1">トピック *</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required={autoGenerate}
                placeholder="例：モバイルアプリの使いやすさ"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">Claude が 5 つの自由回答質問を自動生成します</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">質問</label>
                <span className="text-xs text-gray-600">タイプをクリックで切り替え</span>
              </div>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-gray-600 text-sm pt-2.5 w-5 flex-shrink-0">{i + 1}.</span>
                    <div className="flex-1 flex gap-2">
                      <input
                        value={q.text}
                        onChange={(e) => updateQuestion(i, { text: e.target.value })}
                        placeholder={
                          q.type === 'open' ? `質問 ${i + 1}（自由回答）` :
                          q.type === 'rating' ? '例：この機能の使いやすさは？' :
                          '例：友人にこのサービスを勧めますか？'
                        }
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                      {/* Feature 5: 質問タイプ切り替えボタン */}
                      <button
                        type="button"
                        onClick={() => cycleType(i)}
                        title="クリックでタイプを切り替え"
                        className={`flex-shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${TYPE_COLORS[q.type]}`}
                      >
                        {TYPE_LABELS[q.type]}
                      </button>
                    </div>
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none pt-1.5"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setQuestions([...questions, { text: '', type: 'open' }])}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
              >
                + 質問を追加
              </button>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-700 hover:border-gray-500 py-2 rounded-lg text-sm transition-colors">
              キャンセル
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors">
              {loading ? '作成中...' : '作成する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
