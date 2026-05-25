'use client'

import { useState, useEffect, use } from 'react'
import { ROLE_LABELS, type Role } from '@/lib/permissions'
import { Link2Off, AlertCircle } from 'lucide-react'

interface InviteInfo {
  orgName: string
  role:    string
  email:   string | null
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return }
        setInfo(data)
        if (data.email) setEmail(data.email)
      })
      .catch(() => setError('ネットワークエラーが発生しました'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setSubmitError('パスワードが一致しません'); return }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setSubmitError(data.error ?? 'エラーが発生しました'); return }
      window.location.href = '/dashboard'
    } catch {
      setSubmitError('ネットワークエラーが発生しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-3">
            <Link2Off className="w-5 h-5 text-red-600" strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-semibold text-gray-900 mb-1 tracking-tight">招待リンクが無効です</h1>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  const roleLabel = ROLE_LABELS[info!.role as Role] ?? info!.role

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight mb-1">UserVoice</h1>
          <p className="text-gray-500 text-sm mt-2">
            <span className="text-gray-900 font-medium">{info!.orgName}</span> に招待されています
          </p>
          <span className="inline-block mt-2 text-[10px] font-medium uppercase tracking-wide text-gray-700 bg-white border border-gray-300 rounded-md px-2 py-0.5">
            {roleLabel}として参加
          </span>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">名前 <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="例：田中 太郎" required disabled={submitting}
              className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">メールアドレス <span className="text-red-500">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="例：tanaka@example.com" required disabled={submitting || !!info!.email}
              className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              パスワード <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">(8文字以上)</span>
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="8文字以上" required minLength={8} disabled={submitting}
              className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">パスワード（確認） <span className="text-red-500">*</span></label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="もう一度入力" required disabled={submitting}
              className={inputClass} />
          </div>

          {submitError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{submitError}</span>
            </div>
          )}

          <button type="submit" disabled={submitting}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-md text-sm font-medium transition-colors">
            {submitting ? '参加中...' : '組織に参加する'}
          </button>

          <p className="text-center text-xs text-gray-500">
            すでにアカウントをお持ちの場合も同じメールアドレスで登録できます
          </p>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50'
