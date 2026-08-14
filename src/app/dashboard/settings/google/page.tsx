'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

interface Status {
  configured: boolean
  connected: boolean
  email: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Googleの同意画面でキャンセルされました',
  invalid_state: '認証の照合に失敗しました。もう一度お試しください',
  exchange_failed: 'Googleとの認証に失敗しました。もう一度お試しください',
  unauthorized: 'ログインの有効期限が切れています。再度ログインしてからお試しください',
  not_configured: 'Google連携がまだ設定されていません（管理者にお問い合わせください）',
}

export default function GoogleSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  // クエリパラメータ（/api/auth/google/callback からのリダイレクト結果）は
  // 初回レンダー時に一度だけ読む。setState をエフェクト内で呼ばないよう遅延初期化する
  const [queryError] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('error')
  )
  const [justConnected, setJustConnected] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : new URLSearchParams(window.location.search).get('connected') === '1'
  )

  useEffect(() => {
    // URLの一時パラメータは表示後に消す（リロードで再表示されないように）。
    // DOM操作であり React state の更新ではないので、通常のエフェクトで問題ない
    const params = new URLSearchParams(window.location.search)
    if (params.has('error') || params.has('connected')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/google/status')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setError('連携状況の取得に失敗しました'); return }
        setStatus(await res.json())
      })
      .catch(() => { if (!cancelled) setError('ネットワークエラーが発生しました') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function disconnect() {
    if (!confirm('Googleアカウントの接続を解除しますか？')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' })
      if (!res.ok) { alert('解除に失敗しました'); return }
      setStatus((s) => (s ? { ...s, connected: false, email: null } : s))
      setJustConnected(false)
    } catch {
      alert('通信エラーが発生しました')
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-gray-500 hover:text-gray-900 text-sm">← ダッシュボード</a>
          <span className="text-gray-300">/</span>
          <h1 className="text-lg font-semibold tracking-tight">Google連携</h1>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          テスト結果のスライド資料を自動生成する機能で使います。接続するとご自身のGoogleアカウントのDriveにスライドが保存され、
          誰のアカウントで生成したかに関わらず、その場で内容を編集・共有できます。組織の他のメンバーには影響しません。
        </p>

        {justConnected && (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            Googleアカウントを接続しました
          </p>
        )}
        {queryError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {ERROR_MESSAGES[queryError] ?? 'エラーが発生しました'}
          </p>
        )}

        {status && (
          status.configured ? (
            <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
              {status.connected ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" strokeWidth={2} />
                    <span>{status.email ?? '不明なアカウント'} として接続中</span>
                  </div>
                  <button
                    onClick={disconnect}
                    disabled={disconnecting}
                    className="border border-gray-300 hover:border-red-400 hover:text-red-700 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors"
                  >
                    {disconnecting ? '解除中...' : '接続を解除'}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <XCircle className="w-4 h-4" strokeWidth={2} />
                    <span>未接続</span>
                  </div>
                  <a
                    href="/api/auth/google/connect"
                    className="inline-block bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Googleアカウントを接続
                  </a>
                </>
              )}
            </section>
          ) : (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              この環境ではGoogle連携が設定されていません。
            </p>
          )
        )}
      </div>
    </div>
  )
}
