'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface Props {
  interviewId: string
  onClose: () => void
  onCreated: (session: { joinUrl?: string; dailyRoomUrl?: string }) => void
}

export default function CreateSessionModal({ interviewId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<{ joinUrl: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId,
          participantName: name || undefined,
          participantEmail: email || undefined,
        }),
      })
      const session = await res.json()
      setCreated({ joinUrl: session.joinUrl })
    } finally {
      setLoading(false)
    }
  }

  async function copyAndClose() {
    if (!created) return
    await navigator.clipboard.writeText(created.joinUrl)
    onCreated({ joinUrl: created.joinUrl })
  }

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-md shadow-xl">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">インタビューセッションを作成</h2>
        </div>

        {!created ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">参加者名（任意）</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：田中太郎"
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">メールアドレス（任意）</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="taro@example.com"
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none"
              />
            </div>
            <p className="text-xs text-gray-500">
              セッションを作成するとインタビューURLが発行されます。被験者にURLを共有してください。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 py-2 rounded-md text-sm transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {loading ? '作成中...' : '作成する'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4">
              <div className="text-emerald-700 font-semibold tracking-tight mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                セッションが作成されました
              </div>
              <p className="text-sm text-gray-700 break-all">{created.joinUrl}</p>
            </div>
            <p className="text-sm text-gray-700">
              このURLを被験者に共有してください。被験者はブラウザでアクセスするだけでインタビューに参加できます。
            </p>
            <div className="flex gap-3">
              <button
                onClick={copyAndClose}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white py-2 rounded-md text-sm font-medium transition-colors"
              >
                URLをコピーして閉じる
              </button>
            </div>
            <button
              onClick={() => window.open(created.joinUrl, '_blank')}
              className="w-full border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 py-2 rounded-md text-sm transition-colors"
            >
              今すぐインタビューを開始する
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
