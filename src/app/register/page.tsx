'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) {
      setError('パスワードが一致しません')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName: form.orgName,
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return }
      router.replace('/dashboard')
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-indigo-400 mb-1">UserVoice</h1>
          <p className="text-gray-500 text-sm">アカウントを作成してはじめましょう</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <Field label="組織・会社名" required>
            <input type="text" value={form.orgName} onChange={update('orgName')}
              placeholder="例：Acme Inc." required disabled={loading}
              className={inputClass} />
          </Field>
          <Field label="あなたの名前" required>
            <input type="text" value={form.name} onChange={update('name')}
              placeholder="例：田中 太郎" required disabled={loading}
              className={inputClass} />
          </Field>
          <Field label="メールアドレス" required>
            <input type="email" value={form.email} onChange={update('email')}
              placeholder="例：tanaka@example.com" required disabled={loading}
              className={inputClass} />
          </Field>
          <Field label="パスワード" hint="8文字以上" required>
            <input type="password" value={form.password} onChange={update('password')}
              placeholder="8文字以上" required minLength={8} disabled={loading}
              className={inputClass} />
          </Field>
          <Field label="パスワード（確認）" required>
            <input type="password" value={form.confirm} onChange={update('confirm')}
              placeholder="もう一度入力" required disabled={loading}
              className={inputClass} />
          </Field>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {loading ? '作成中...' : 'アカウントを作成'}
          </button>

          <p className="text-center text-sm text-gray-500">
            既にアカウントをお持ちの方は{' '}
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300">ログイン</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 focus:outline-none rounded-lg px-3 py-2.5 text-white placeholder-gray-600 text-sm transition-colors disabled:opacity-50'

function Field({ label, hint, required, children }: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
        {hint && <span className="text-gray-600 text-xs ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}
