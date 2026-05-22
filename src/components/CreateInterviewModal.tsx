'use client'

import { useState } from 'react'

type InterviewType = 'interview' | 'impression' | 'usability'

interface QuestionItem {
  text: string
  type: 'open' | 'rating' | 'nps'
}

interface TaskItem { text: string }

interface Props {
  onClose: () => void
  onCreated: () => void
}

const QUESTION_TYPE_LABELS = { open: '自由回答', rating: '5段階評価', nps: 'NPS (0-10)' }
const QUESTION_TYPE_COLORS = {
  open:   'bg-gray-700 text-gray-300',
  rating: 'bg-blue-900/60 text-blue-300',
  nps:    'bg-green-900/60 text-green-300',
}

const SESSION_TYPES: { value: InterviewType; icon: string; label: string; desc: string }[] = [
  { value: 'interview',   icon: '📝', label: 'インタビュー',         desc: '音声 Q&A + 感情計測' },
  { value: 'impression',  icon: '🖼️', label: '印象テスト',           desc: '画像を見せて反応を計測' },
  { value: 'usability',   icon: '🖥️', label: 'ユーザビリティテスト', desc: '画面操作 + 感情計測' },
]

export default function CreateInterviewModal({ onClose, onCreated }: Props) {
  const [sessionType, setSessionType] = useState<InterviewType>('interview')
  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  // interview
  const [questions, setQuestions]     = useState<QuestionItem[]>([
    { text: '', type: 'open' },
    { text: '', type: 'open' },
    { text: '', type: 'open' },
  ])
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [topic, setTopic]               = useState('')
  // impression / prototype
  const [stimulusUrl, setStimulusUrl]         = useState('')
  const [stimulusDuration, setStimulusDuration] = useState(5)
  // usability sub-type
  const [usabilityMode, setUsabilityMode] = useState<'prototype' | 'service'>('prototype')
  // prototype / usability
  const [tasks, setTasks] = useState<TaskItem[]>([{ text: '' }, { text: '' }])
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
          description:      description || undefined,
          type:             sessionType,
          usabilityMode:    sessionType === 'usability' ? usabilityMode : undefined,
          stimulusUrl:      (sessionType === 'impression' || sessionType === 'usability') ? (stimulusUrl || undefined) : undefined,
          stimulusDuration: sessionType === 'impression' ? stimulusDuration : undefined,
          tasks:            sessionType === 'usability'
            ? tasks.filter((t) => t.text.trim()).map((t, i) => ({ text: t.text, order: i + 1 }))
            : undefined,
          questions: sessionType === 'interview'
            ? (autoGenerate ? [] : questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text, type: q.type })))
            : questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text, type: q.type })),
          autoGenerate: sessionType === 'interview' ? autoGenerate : false,
          topic:        (sessionType === 'interview' && autoGenerate) ? topic : undefined,
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
    updateQuestion(i, { type: order[(order.indexOf(current) + 1) % order.length] })
  }

  function updateTask(i: number, text: string) {
    const next = [...tasks]
    next[i] = { text }
    setTasks(next)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold">インタビューを手動で作成</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* セッションタイプ選択 */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">セッションタイプ</label>
            <div className="grid grid-cols-2 gap-2">
              {SESSION_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSessionType(t.value)}
                  className={`flex items-start gap-2 p-3 rounded-xl border text-left transition-colors ${
                    sessionType === t.value
                      ? 'border-indigo-500 bg-indigo-900/30 text-white'
                      : 'border-gray-700 hover:border-gray-600 text-gray-400'
                  }`}
                >
                  <span className="text-lg leading-none mt-0.5">{t.icon}</span>
                  <div>
                    <div className="text-xs font-medium leading-tight">{t.label}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ユーザビリティテスト: サブタイプ選択 */}
          {sessionType === 'usability' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">テストの種類</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setUsabilityMode('prototype')}
                  className={`p-3 rounded-xl border text-left text-xs transition-colors ${usabilityMode === 'prototype' ? 'border-indigo-500 bg-indigo-900/30 text-white' : 'border-gray-700 text-gray-400'}`}>
                  <div className="font-medium mb-0.5">🎨 プロトタイプ</div>
                  <div className="text-[10px] text-gray-500">Figma / ProtoPie など</div>
                </button>
                <button type="button" onClick={() => setUsabilityMode('service')}
                  className={`p-3 rounded-xl border text-left text-xs transition-colors ${usabilityMode === 'service' ? 'border-indigo-500 bg-indigo-900/30 text-white' : 'border-gray-700 text-gray-400'}`}>
                  <div className="font-medium mb-0.5">🌐 実際のサービス</div>
                  <div className="text-[10px] text-gray-500">本番サービスのURL</div>
                </button>
              </div>
            </div>
          )}

          {/* タイトル */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">タイトル *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="例：新機能のユーザビリティテスト"
              className={inputClass}
            />
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="目的や対象者を記述..."
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* 🖼️ 印象テスト専用フィールド */}
          {sessionType === 'impression' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">画像URL *</label>
                <input
                  value={stimulusUrl}
                  onChange={(e) => setStimulusUrl(e.target.value)}
                  placeholder="https://example.com/image.png"
                  className={inputClass}
                />
                <p className="text-xs text-gray-600 mt-1">公開されている画像のURLを貼り付けてください</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">表示秒数（デフォルト: 5秒）</label>
                <input
                  type="number"
                  value={stimulusDuration}
                  onChange={(e) => setStimulusDuration(Number(e.target.value))}
                  min={1} max={60}
                  className={`${inputClass} w-24`}
                />
              </div>
            </>
          )}

          {/* 🖥️ ユーザビリティテスト専用フィールド */}
          {sessionType === 'usability' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                {usabilityMode === 'prototype' ? 'プロトタイプURL' : 'サービスURL（参考用）'}
              </label>
              <input
                value={stimulusUrl}
                onChange={(e) => setStimulusUrl(e.target.value)}
                placeholder={usabilityMode === 'prototype' ? 'https://www.figma.com/proto/...' : 'https://example.com'}
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-1">
                {usabilityMode === 'prototype' ? 'Figma / ProtoPie などのプロトタイプ共有URLを入力してください' : '実際に操作するサービスのURL（メモ用）'}
              </p>
            </div>
          )}

          {/* タスクリスト (usability) */}
          {sessionType === 'usability' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">タスクリスト</label>
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <span className="text-gray-600 text-xs w-4 text-right">{i + 1}.</span>
                    <input
                      value={t.text}
                      onChange={(e) => updateTask(i, e.target.value)}
                      placeholder={`タスク ${i + 1}（例：ログインしてみてください）`}
                      className={inputClass}
                    />
                    {tasks.length > 1 && (
                      <button type="button" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none">×</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setTasks([...tasks, { text: '' }])}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
                + タスクを追加
              </button>
            </div>
          )}

          {/* 📝 インタビュー質問 (interview 共通 + 他タイプでも追加できる) */}
          {sessionType === 'interview' && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoGenerate}
                  onChange={(e) => setAutoGenerate(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500" />
                <span className="text-sm text-gray-300">AI で質問を自動生成</span>
              </label>

              {autoGenerate ? (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">トピック *</label>
                  <input value={topic} onChange={(e) => setTopic(e.target.value)}
                    required={autoGenerate}
                    placeholder="例：モバイルアプリの使いやすさ"
                    className={inputClass} />
                  <p className="text-xs text-gray-500 mt-1">AI が 5 つの自由回答質問を自動生成します</p>
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
                            placeholder={`質問 ${i + 1}`}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                          />
                          <button type="button" onClick={() => cycleType(i)}
                            className={`flex-shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${QUESTION_TYPE_COLORS[q.type]}`}>
                            {QUESTION_TYPE_LABELS[q.type]}
                          </button>
                        </div>
                        {questions.length > 1 && (
                          <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                            className="text-gray-600 hover:text-red-400 text-lg leading-none pt-1.5">×</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setQuestions([...questions, { text: '', type: 'open' }])}
                    className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
                    + 質問を追加
                  </button>
                </div>
              )}
            </>
          )}

          {/* 印象/プロト/ユーザビリティの場合も質問を追加できる */}
          {sessionType !== 'interview' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">事後質問（任意）</label>
                <span className="text-xs text-gray-600">テスト後に聞く質問</span>
              </div>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-gray-600 text-sm pt-2.5 w-5 flex-shrink-0">{i + 1}.</span>
                    <input
                      value={q.text}
                      onChange={(e) => updateQuestion(i, { text: e.target.value })}
                      placeholder="例：全体的な印象を教えてください"
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    />
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none pt-1.5">×</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setQuestions([...questions, { text: '', type: 'open' }])}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
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

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
