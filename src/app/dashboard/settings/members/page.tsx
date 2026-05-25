'use client'

import { useState, useEffect } from 'react'
import { ROLE_LABELS, ASSIGNABLE_ROLES, type Role } from '@/lib/permissions'
import { Check, Link2 } from 'lucide-react'

interface Member {
  id:    string
  role:  string
  user:  { id: string; name: string; email: string }
}

interface Invite {
  id:        string
  token:     string
  role:      string
  email:     string | null
  expiresAt: string
  createdBy: { name: string; email: string }
}

export default function MembersPage() {
  const [members, setMembers]   = useState<Member[]>([])
  const [invites, setInvites]   = useState<Invite[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // 招待作成フォーム
  const [newRole, setNewRole]       = useState<'admin' | 'editor' | 'viewer'>('viewer')
  const [newEmail, setNewEmail]     = useState('')
  const [creating, setCreating]     = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [mRes, iRes] = await Promise.all([
        fetch('/api/organizations/members'),
        fetch('/api/organizations/invites'),
      ])
      if (!mRes.ok || !iRes.ok) {
        setError('メンバー情報の取得に失敗しました')
        return
      }
      setMembers(await mRes.json())
      setInvites(await iRes.json())
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  async function createInvite() {
    setCreating(true)
    try {
      const res = await fetch('/api/organizations/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole, email: newEmail || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'エラーが発生しました'); return }
      setInvites((prev) => [data, ...prev])
      setNewEmail('')
    } finally {
      setCreating(false)
    }
  }

  async function revokeInvite(token: string) {
    if (!confirm('この招待リンクを無効にしますか？')) return
    await fetch(`/api/organizations/invites/${token}`, { method: 'DELETE' })
    setInvites((prev) => prev.filter((i) => i.token !== token))
  }

  async function changeRole(userId: string, role: Role) {
    const res = await fetch(`/api/organizations/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? 'エラーが発生しました'); return }
    setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, role } : m))
  }

  async function removeMember(userId: string, name: string) {
    if (!confirm(`${name} をメンバーから削除しますか？`)) return
    const res = await fetch(`/api/organizations/members/${userId}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? 'エラーが発生しました'); return }
    setMembers((prev) => prev.filter((m) => m.user.id !== userId))
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
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
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-gray-500 hover:text-gray-900 text-sm">← ダッシュボード</a>
          <span className="text-gray-300">/</span>
          <h1 className="text-lg font-semibold tracking-tight">メンバー管理</h1>
        </div>

        {/* 招待リンク作成 */}
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">新しい招待リンクを生成</h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">ロール</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none">
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="flex-[2] min-w-[200px]">
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">メールアドレス（任意・特定の人のみ有効にする場合）</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="例：tanaka@example.com（空白で誰でも使用可）"
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none" />
            </div>
          </div>
          <button onClick={createInvite} disabled={creating}
            className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 px-4 py-2 rounded-md text-sm font-medium transition-colors">
            {creating ? '生成中...' : '招待リンクを生成'}
          </button>
        </section>

        {/* 有効な招待リンク一覧 */}
        {invites.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">有効な招待リンク</h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id}
                  className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5">
                        {ROLE_LABELS[inv.role as Role] ?? inv.role}
                      </span>
                      {inv.email && (
                        <span className="text-xs text-gray-700">{inv.email} 専用</span>
                      )}
                      <span className="text-xs text-gray-500">
                        有効期限: {new Date(inv.expiresAt).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      作成者: {inv.createdBy.name}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => copyInviteLink(inv.token)}
                      className="text-xs text-gray-700 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5">
                      {copiedToken === inv.token ? (
                        <>
                          <Check className="w-3 h-3" strokeWidth={2} />
                          コピー済み
                        </>
                      ) : (
                        <>
                          <Link2 className="w-3 h-3" strokeWidth={2} />
                          リンクをコピー
                        </>
                      )}
                    </button>
                    <button onClick={() => revokeInvite(inv.token)}
                      className="text-xs text-red-700 hover:text-red-800 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 rounded-md px-3 py-1.5 transition-colors">
                      無効化
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* メンバー一覧 */}
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">メンバー ({members.length}人)</h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id}
                className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                </div>
                {m.role === 'owner' ? (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-0.5 shrink-0">
                    オーナー
                  </span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user.id, e.target.value as Role)}
                      className="bg-white border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none">
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMember(m.user.id, m.user.name)}
                      className="text-xs text-gray-500 hover:text-red-700 transition-colors px-1">
                      削除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ロール説明 */}
        <section className="bg-gray-50 border border-gray-200 rounded-lg p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">ロールと権限</h2>
          <div className="space-y-2 text-xs text-gray-700">
            <div className="flex gap-3">
              <span className="text-amber-700 w-16 shrink-0">オーナー</span>
              <span>すべての操作が可能。組織の削除・譲渡。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-blue-700 w-16 shrink-0">管理者</span>
              <span>メンバーの招待・管理、インタビューの作成・編集、セッションの閲覧・分析。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-emerald-700 w-16 shrink-0">編集者</span>
              <span>インタビューの作成・編集、セッションの閲覧・分析。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-gray-700 w-16 shrink-0">閲覧者</span>
              <span>インタビューとセッションの閲覧のみ。</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
