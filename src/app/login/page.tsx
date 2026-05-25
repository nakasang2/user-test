'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'

function LoginForm() {
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return }
      window.location.href = from
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1 tracking-tight">UserVoice</h1>
          <p className="text-gray-500 text-sm">ダッシュボードにログイン</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1.5">メールアドレス</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="tanaka@example.com" required autoFocus disabled={loading}
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50" />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-700 mb-1.5">パスワード</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワードを入力" required disabled={loading}
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50" />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-md text-sm font-medium transition-colors">
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>

          <p className="text-center text-sm text-gray-500">
            アカウントをお持ちでない方は{' '}
            <Link href="/register" className="text-gray-900 hover:text-gray-700 font-medium underline underline-offset-2">新規登録</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
