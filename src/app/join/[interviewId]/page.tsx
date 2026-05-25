'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'

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
      router.push(`/interview/${data.roomName}`)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // ── 読み込み中 ──
  if (!interview && !notFound) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  // ── 存在しないインタビュー ──
  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-gray-300 font-medium mb-2">インタビューが見つかりません</p>
          <p className="text-gray-500 text-sm">リンクが無効か、削除された可能性があります。</p>
        </div>
      </div>
    )
  }

  const isUsability = interview!.type === 'usability'
  const isImpression = interview!.type === 'impression'

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-3">
            {isUsability ? '🖥️' : isImpression ? '🖼️' : '🎤'}
          </div>
          <h1 className="text-xl font-bold text-white mb-1">{interview!.title}</h1>
          {interview!.description && (
            <p className="text-gray-400 text-sm leading-relaxed">{interview!.description}</p>
          )}
        </div>

        {/* セッション概要カード */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">参加前にご確認ください</p>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-start gap-2.5">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">⏱</span>
              <span>所要時間：<strong className="text-white">約 15〜30 分</strong></span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">📷</span>
              <span>カメラ・マイクへのアクセスが必要です（表情・音声を録画します）</span>
            </li>
            {isUsability && (
              <li className="flex items-start gap-2.5">
                <span className="text-indigo-400 mt-0.5 flex-shrink-0">🖥️</span>
                <span>画面操作も録画されます（録画は参加者自身が開始します）</span>
              </li>
            )}
            <li className="flex items-start gap-2.5">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">🔇</span>
              <span>静かな場所で、<strong className="text-white">イヤホンなし</strong>での参加を推奨します</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-indigo-400 mt-0.5 flex-shrink-0">💬</span>
              <span>操作・思考の過程を声に出してください（シンクアラウド）</span>
            </li>
          </ul>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm text-gray-400 mb-1.5">
              お名前 <span className="text-red-400">*</span>
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
              className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2.5 text-white placeholder-gray-600 text-sm transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm text-gray-400 mb-1.5">
              メールアドレス <span className="text-gray-600 text-xs">（任意）</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例：tanaka@example.com"
              disabled={loading}
              className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2.5 text-white placeholder-gray-600 text-sm transition-colors disabled:opacity-50"
            />
          </div>

          {/* 録画同意チェック */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={loading}
                className="sr-only"
              />
              <div className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors ${
                consent ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 group-hover:border-gray-400'
              }`}>
                {consent && <span className="text-white text-[11px] font-bold leading-none">✓</span>}
              </div>
            </div>
            <span className="text-xs text-gray-400 leading-relaxed">
              カメラ・マイク・画面の録画および AI による分析に同意します。
              収集した情報は本調査目的にのみ使用されます。
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim() || !consent}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? '準備中...' : 'インタビューを開始する →'}
          </button>

          {!consent && name.trim() && (
            <p className="text-center text-xs text-amber-500">
              同意のチェックボックスをオンにしてください
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
