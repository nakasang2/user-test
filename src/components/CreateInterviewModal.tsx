'use client'

import { useState } from 'react'
import { track } from '@/lib/analytics'
import {
  MessageSquare,
  Image as ImageIcon,
  Monitor,
  Palette,
  Globe,
  Plus,
  X,
  Sparkles,
} from 'lucide-react'

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
  open:   'bg-gray-100 text-gray-700 border-gray-200',
  rating: 'bg-blue-50 text-blue-700 border-blue-200',
  nps:    'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const SESSION_TYPES: { value: InterviewType; icon: React.ReactNode; label: string; desc: string }[] = [
  { value: 'interview',   icon: <MessageSquare className="w-4 h-4" strokeWidth={1.75} />, label: 'インタビュー',         desc: '音声 Q&A + 感情計測' },
  { value: 'impression',  icon: <ImageIcon className="w-4 h-4" strokeWidth={1.75} />,     label: '印象テスト',           desc: '画像を見せて反応を計測' },
  { value: 'usability',   icon: <Monitor className="w-4 h-4" strokeWidth={1.75} />,       label: 'ユーザビリティテスト', desc: '画面操作 + 感情計測' },
]

export default function CreateInterviewModal({ onClose, onCreated }: Props) {
  const [sessionType, setSessionType] = useState<InterviewType>('interview')
  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions]     = useState<QuestionItem[]>([
    { text: '', type: 'open' },
    { text: '', type: 'open' },
    { text: '', type: 'open' },
  ])
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [topic, setTopic]               = useState('')
  const [stimulusUrl, setStimulusUrl]         = useState('')
  const [stimulusDuration, setStimulusDuration] = useState(5)
  const [usabilityMode, setUsabilityMode] = useState<'prototype' | 'service'>('prototype')
  const [tasks, setTasks] = useState<TaskItem[]>([{ text: '' }, { text: '' }])
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/interviews', {
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
      if (res.ok) track('interview_created', { type: sessionType })
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
    <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-gray-900">インタビューを手動で作成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">セッションタイプ</label>
            <div className="grid grid-cols-3 gap-2">
              {SESSION_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSessionType(t.value)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-md border text-left transition-colors ${
                    sessionType === t.value
                      ? 'border-gray-900 bg-white'
                      : 'border-gray-300 hover:border-gray-400 bg-white'
                  }`}
                >
                  <span className={sessionType === t.value ? 'text-gray-900' : 'text-gray-500'}>{t.icon}</span>
                  <div>
                    <div className={`text-xs font-medium leading-tight ${sessionType === t.value ? 'text-gray-900' : 'text-gray-700'}`}>{t.label}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {sessionType === 'usability' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">テストの種類</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setUsabilityMode('prototype')}
                  className={`p-3 rounded-md border text-left text-xs transition-colors ${usabilityMode === 'prototype' ? 'border-gray-900 bg-white' : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
                  <div className="flex items-center gap-1.5 font-medium mb-0.5 text-gray-900"><Palette className="w-3.5 h-3.5" strokeWidth={1.75} />プロトタイプ</div>
                  <div className="text-[10px] text-gray-500">Figma / ProtoPie など</div>
                </button>
                <button type="button" onClick={() => setUsabilityMode('service')}
                  className={`p-3 rounded-md border text-left text-xs transition-colors ${usabilityMode === 'service' ? 'border-gray-900 bg-white' : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
                  <div className="flex items-center gap-1.5 font-medium mb-0.5 text-gray-900"><Globe className="w-3.5 h-3.5" strokeWidth={1.75} />実際のサービス</div>
                  <div className="text-[10px] text-gray-500">本番サービスのURL</div>
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">タイトル <span className="text-red-500">*</span></label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="例：新機能のユーザビリティテスト"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">説明 <span className="text-gray-400 font-normal">（任意）</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="目的や対象者を記述..."
              className={`${inputClass} resize-none`}
            />
          </div>

          {sessionType === 'impression' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">画像URL <span className="text-red-500">*</span></label>
                <input
                  value={stimulusUrl}
                  onChange={(e) => setStimulusUrl(e.target.value)}
                  placeholder="https://example.com/image.png"
                  className={inputClass}
                />
                <p className="text-xs text-gray-500 mt-1">公開されている画像のURLを貼り付けてください</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">表示秒数（デフォルト: 5秒）</label>
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

          {sessionType === 'usability' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                {usabilityMode === 'prototype' ? 'プロトタイプURL' : 'サービスURL（参考用）'}
              </label>
              <input
                value={stimulusUrl}
                onChange={(e) => setStimulusUrl(e.target.value)}
                placeholder={usabilityMode === 'prototype' ? 'https://www.figma.com/proto/...' : 'https://example.com'}
                className={inputClass}
              />
              <p className="text-xs text-gray-500 mt-1">
                {usabilityMode === 'prototype' ? 'Figma / ProtoPie などのプロトタイプ共有URLを入力してください' : '実際に操作するサービスのURL（メモ用）'}
              </p>
            </div>
          )}

          {sessionType === 'usability' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">タスクリスト</label>
              <div className="space-y-1.5">
                {tasks.map((t, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <span className="text-gray-400 text-xs w-5 text-right">{i + 1}.</span>
                    <input
                      value={t.text}
                      onChange={(e) => updateTask(i, e.target.value)}
                      placeholder={`タスク ${i + 1}（例：ログインしてみてください）`}
                      className={inputClass}
                    />
                    {tasks.length > 1 && (
                      <button type="button" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                        className="text-gray-300 hover:text-red-600 transition-colors p-1">
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setTasks([...tasks, { text: '' }])}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900">
                <Plus className="w-3 h-3" strokeWidth={2} />
                タスクを追加
              </button>
            </div>
          )}

          {sessionType === 'interview' && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoGenerate}
                  onChange={(e) => setAutoGenerate(e.target.checked)}
                  className="w-4 h-4 accent-gray-900" />
                <span className="text-sm text-gray-700 inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-gray-500" strokeWidth={1.75} />
                  AI で質問を自動生成
                </span>
              </label>

              {autoGenerate ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">トピック <span className="text-red-500">*</span></label>
                  <input value={topic} onChange={(e) => setTopic(e.target.value)}
                    required={autoGenerate}
                    placeholder="例：モバイルアプリの使いやすさ"
                    className={inputClass} />
                  <p className="text-xs text-gray-500 mt-1">AI が 5 つの自由回答質問を自動生成します</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-700">質問</label>
                    <span className="text-xs text-gray-400">タイプをクリックで切り替え</span>
                  </div>
                  <div className="space-y-1.5">
                    {questions.map((q, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-gray-400 text-xs pt-2 w-5 flex-shrink-0 text-right">{i + 1}.</span>
                        <div className="flex-1 flex gap-2">
                          <input
                            value={q.text}
                            onChange={(e) => updateQuestion(i, { text: e.target.value })}
                            placeholder={`質問 ${i + 1}`}
                            className={inputClass}
                          />
                          <button type="button" onClick={() => cycleType(i)}
                            className={`flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${QUESTION_TYPE_COLORS[q.type]}`}>
                            {QUESTION_TYPE_LABELS[q.type]}
                          </button>
                        </div>
                        {questions.length > 1 && (
                          <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                            className="text-gray-300 hover:text-red-600 transition-colors p-1 mt-1">
                            <X className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setQuestions([...questions, { text: '', type: 'open' }])}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900">
                    <Plus className="w-3 h-3" strokeWidth={2} />
                    質問を追加
                  </button>
                </div>
              )}
            </>
          )}

          {sessionType !== 'interview' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">事後質問 <span className="text-gray-400 font-normal">（任意）</span></label>
                <span className="text-xs text-gray-400">テスト後に聞く質問</span>
              </div>
              <div className="space-y-1.5">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-gray-400 text-xs pt-2 w-5 flex-shrink-0 text-right">{i + 1}.</span>
                    <input
                      value={q.text}
                      onChange={(e) => updateQuestion(i, { text: e.target.value })}
                      placeholder="例：全体的な印象を教えてください"
                      className={inputClass}
                    />
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="text-gray-300 hover:text-red-600 transition-colors p-1 mt-1">
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setQuestions([...questions, { text: '', type: 'open' }])}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900">
                <Plus className="w-3 h-3" strokeWidth={2} />
                質問を追加
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 py-2 rounded-md text-sm transition-colors">
              キャンセル
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 py-2 rounded-md text-sm font-medium transition-colors">
              {loading ? '作成中...' : '作成する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400'
