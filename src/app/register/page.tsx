'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'

export default function RegisterPage() {
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
      window.location.href = '/dashboard'
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1 tracking-tight">UserVoice</h1>
          <p className="text-gray-500 text-sm">アカウントを作成してはじめましょう</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
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
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-md text-sm font-medium transition-colors">
            {loading ? '作成中...' : 'アカウントを作成'}
          </button>

          <p className="text-center text-sm text-gray-500">
            既にアカウントをお持ちの方は{' '}
            <Link href="/login" className="text-gray-900 hover:text-gray-700 font-medium underline underline-offset-2">ログイン</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm transition-colors disabled:opacity-50'

function Field({ label, hint, required, children }: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}
