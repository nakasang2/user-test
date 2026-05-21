'use client'

import { useState } from 'react'

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md">
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold">インタビューセッションを作成</h2>
        </div>

        {!created ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">参加者名（任意）</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：田中太郎"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">メールアドレス（任意）</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="taro@example.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <p className="text-xs text-gray-500">
              セッションを作成するとインタビューURLが発行されます。被験者にURLを共有してください。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-700 hover:border-gray-500 py-2 rounded-lg text-sm transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {loading ? '作成中...' : '作成する'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="bg-green-900/30 border border-green-800 rounded-xl p-4">
              <div className="text-green-400 font-semibold mb-2">セッションが作成されました</div>
              <p className="text-sm text-gray-300 break-all">{created.joinUrl}</p>
            </div>
            <p className="text-sm text-gray-400">
              このURLを被験者に共有してください。被験者はブラウザでアクセスするだけでインタビューに参加できます。
            </p>
            <div className="flex gap-3">
              <button
                onClick={copyAndClose}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                URLをコピーして閉じる
              </button>
            </div>
            <button
              onClick={() => window.open(created.joinUrl, '_blank')}
              className="w-full border border-gray-700 hover:border-gray-500 py-2 rounded-lg text-sm transition-colors"
            >
              今すぐインタビューを開始する
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
