'use client'

import { useState, useEffect } from 'react'
import { ROLE_LABELS, ASSIGNABLE_ROLES, type Role } from '@/lib/permissions'

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-gray-500 hover:text-gray-300 text-sm">← ダッシュボード</a>
          <span className="text-gray-700">/</span>
          <h1 className="text-lg font-semibold">メンバー管理</h1>
        </div>

        {/* 招待リンク作成 */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">新しい招待リンクを生成</h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1">ロール</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none">
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="flex-[2] min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">メールアドレス（任意・特定の人のみ有効にする場合）</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="例：tanaka@example.com（空白で誰でも使用可）"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none" />
            </div>
          </div>
          <button onClick={createInvite} disabled={creating}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {creating ? '生成中...' : '招待リンクを生成'}
          </button>
        </section>

        {/* 有効な招待リンク一覧 */}
        {invites.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-400">有効な招待リンク</h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-indigo-300 bg-indigo-900/40 border border-indigo-700 rounded-full px-2 py-0.5">
                        {ROLE_LABELS[inv.role as Role] ?? inv.role}
                      </span>
                      {inv.email && (
                        <span className="text-xs text-gray-400">{inv.email} 専用</span>
                      )}
                      <span className="text-xs text-gray-600">
                        有効期限: {new Date(inv.expiresAt).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">
                      作成者: {inv.createdBy.name}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => copyInviteLink(inv.token)}
                      className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors">
                      {copiedToken === inv.token ? '✓ コピー済み' : '🔗 リンクをコピー'}
                    </button>
                    <button onClick={() => revokeInvite(inv.token)}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded-lg px-3 py-1.5 transition-colors">
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
          <h2 className="text-sm font-semibold text-gray-400">メンバー ({members.length}人)</h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id}
                className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                </div>
                {m.role === 'owner' ? (
                  <span className="text-xs text-amber-400 bg-amber-900/30 border border-amber-700/50 rounded-full px-3 py-0.5 shrink-0">
                    オーナー
                  </span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user.id, e.target.value as Role)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none">
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMember(m.user.id, m.user.name)}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors px-1">
                      削除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ロール説明 */}
        <section className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">ロールと権限</h2>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex gap-3">
              <span className="text-amber-400 w-16 shrink-0">オーナー</span>
              <span>すべての操作が可能。組織の削除・譲渡。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-indigo-400 w-16 shrink-0">管理者</span>
              <span>メンバーの招待・管理、インタビューの作成・編集、セッションの閲覧・分析。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-green-400 w-16 shrink-0">編集者</span>
              <span>インタビューの作成・編集、セッションの閲覧・分析。</span>
            </div>
            <div className="flex gap-3">
              <span className="text-gray-400 w-16 shrink-0">閲覧者</span>
              <span>インタビューとセッションの閲覧のみ。</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
