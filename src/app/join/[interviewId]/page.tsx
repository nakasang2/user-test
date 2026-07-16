'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { track } from '@/lib/analytics'
import {
  Video,
  Monitor,
  VolumeX,
  MessageSquare,
  Clock,
  Search,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'

interface InterviewInfo {
  id: string
  title: string
  description: string | null
  type?: string
  _count?: { questions: number }
}

export default function JoinPage(props: { params: Promise<{ interviewId: string }> }) {
  const { interviewId } = use(props.params)
  const router = useRouter()

  const [interview, setInterview] = useState<InterviewInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    track('join_viewed', { interviewId })
    fetch(`/api/join/${interviewId}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then((d) => d && setInterview(d))
  }, [interviewId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !consent) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/join/${interviewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return }
      track('interview_started', { interviewId })
      router.push(`/interview/${data.roomName}`)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  if (!interview && !notFound) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Search className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
          </div>
          <p className="text-gray-900 font-medium mb-1.5">インタビューが見つかりません</p>
          <p className="text-gray-500 text-sm">リンクが無効か、削除された可能性があります。</p>
        </div>
      </div>
    )
  }

  const isUsability = interview!.type === 'usability'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1 tracking-tight">{interview!.title}</h1>
          {interview!.description && (
            <p className="text-gray-500 text-sm leading-relaxed">{interview!.description}</p>
          )}
        </div>

        {/* セッション概要カード */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-3 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">参加前にご確認ください</p>
          <ul className="space-y-2.5 text-sm text-gray-700">
            <li className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
              <span>所要時間：<strong className="text-gray-900 font-medium">約 15〜30 分</strong></span>
            </li>
            <li className="flex items-start gap-2.5">
              <Video className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
              <span>カメラ・マイクへのアクセスが必要です（表情・音声を録画します）</span>
            </li>
            {isUsability && (
              <li className="flex items-start gap-2.5">
                <Monitor className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <span>画面操作も録画されます（録画は参加者自身が開始します）</span>
              </li>
            )}
            <li className="flex items-start gap-2.5">
              <VolumeX className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
              <span>静かな場所で、<strong className="text-gray-900 font-medium">イヤホンなし</strong>での参加を推奨します</span>
            </li>
            <li className="flex items-start gap-2.5">
              <MessageSquare className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
              <span>操作・思考の過程を声に出してください（シンクアラウド）</span>
            </li>
          </ul>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-xs font-medium text-gray-700 mb-1.5">
              お名前 <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：田中 太郎"
              autoFocus
              required
              disabled={loading}
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1.5">
              メールアドレス <span className="text-gray-400 font-normal">（任意）</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例：tanaka@example.com"
              disabled={loading}
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50"
            />
          </div>

          {/* 録画同意チェック */}
          <label className="flex items-start gap-2.5 cursor-pointer group pt-1">
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={loading}
                aria-label="録画・分析への同意"
                className="peer sr-only"
              />
              <div className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gray-900 peer-focus-visible:ring-offset-2 ${
                consent ? 'bg-gray-900 border-gray-900' : 'bg-white border-gray-300 group-hover:border-gray-500'
              }`}>
                {consent && <span className="text-white text-[11px] font-bold leading-none">✓</span>}
              </div>
            </div>
            <span className="text-xs text-gray-600 leading-relaxed">
              カメラ・マイク・画面の録画、表情からの分析、および AI による文字起こし・要約に同意します。
              録画・テキストは AI 分析のため外部サービスに送信される場合があります。
              収集した情報は本調査目的にのみ利用し、取扱い・保持期間・削除請求の方法は
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-gray-900 underline hover:no-underline">プライバシーポリシー</a>
              に従います（
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-gray-900 underline hover:no-underline">利用規約</a>
              ）。
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim() || !consent}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-md text-sm font-medium transition-colors"
          >
            {loading ? '準備中...' : (<>インタビューを開始する<ArrowRight className="w-4 h-4" strokeWidth={2} /></>)}
          </button>

          {!consent && name.trim() && (
            <p className="text-center text-xs text-amber-700">
              同意のチェックボックスをオンにしてください
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
