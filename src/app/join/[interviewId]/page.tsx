'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'

interface InterviewInfo {
  id: string
  title: string
  description: string | null
}

export default function JoinPage(props: { params: Promise<{ interviewId: string }> }) {
  const { interviewId } = use(props.params)
  const router = useRouter()

  const [interview, setInterview] = useState<InterviewInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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
    if (!name.trim()) return
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

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-3">🎤</div>
          <h1 className="text-xl font-bold text-white mb-1">{interview!.title}</h1>
          {interview!.description && (
            <p className="text-gray-400 text-sm">{interview!.description}</p>
          )}
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

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? '準備中...' : 'インタビューを開始する →'}
          </button>

          <p className="text-center text-xs text-gray-600">
            開始するとカメラ・マイクの許可が求められます
          </p>
        </form>
      </div>
    </div>
  )
}
