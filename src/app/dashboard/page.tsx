'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import CreateInterviewModal from '@/components/CreateInterviewModal'
import StatusBadge from '@/components/StatusBadge'

interface Question {
  id: string
  text: string
  order: number
  type: string
}

interface Interview {
  id: string
  title: string
  description: string | null
  questions: Question[]
  _count: { sessions: number }
  createdAt: string
}

interface Session {
  id: string
  status: string
  dailyRoomName: string
  dailyRoomUrl: string
  createdAt: string
  interview: { id: string; title: string }
  participant: { name: string } | null
  transcript: { summary: string | null } | null
  _count: { emotions: number }
}

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'status'
type StatusFilter = 'all' | 'pending' | 'active' | 'done' | 'completed'

const STATUS_LABELS: Record<string, string> = {
  all: 'すべて',
  pending: '待機中',
  active: '進行中',
  done: '分析済み',
  completed: '完了',
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date-desc', label: '新しい順' },
  { value: 'date-asc',  label: '古い順'   },
  { value: 'name-asc',  label: '参加者名順' },
  { value: 'status',    label: 'ステータス順' },
]

export default function Dashboard() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showCreateInterview, setShowCreateInterview] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // 招待リンクのコピー完了表示用（インタビューID）
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // ── フィルタ / ソート ──
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date-desc')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [iv, sv] = await Promise.all([
      fetch('/api/interviews').then((r) => r.json()),
      fetch('/api/sessions').then((r) => r.json()),
    ])
    setInterviews(iv)
    setSessions(sv)
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function copyInviteLink(interviewId: string, e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}/join/${interviewId}`
    await navigator.clipboard.writeText(url)
    setCopiedInviteId(interviewId)
    setTimeout(() => setCopiedInviteId(null), 2000)
  }

  async function copyInterviewUrl(session: Session, e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}/interview/${session.dailyRoomName}`
    await navigator.clipboard.writeText(url)
    setCopiedId(session.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.preventDefault()
    setDeletingId(id)
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  // ── フィルタ・ソート済みのグループ ──
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return interviews
      .map((iv) => {
        // このインタビューのセッションを抽出
        let list = sessions.filter((s) => s.interview.id === iv.id)

        // 参加者名検索
        if (q) {
          list = list.filter((s) =>
            (s.participant?.name ?? 'anonymous').toLowerCase().includes(q)
          )
        }

        // ステータスフィルタ
        if (statusFilter !== 'all') {
          list = list.filter((s) => s.status === statusFilter)
        }

        // ソート
        list = [...list].sort((a, b) => {
          switch (sortKey) {
            case 'date-desc':
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            case 'date-asc':
              return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            case 'name-asc':
              return (a.participant?.name ?? '').localeCompare(b.participant?.name ?? '', 'ja')
            case 'status': {
              const order = ['active', 'pending', 'processing', 'completed', 'done']
              return order.indexOf(a.status) - order.indexOf(b.status)
            }
          }
        })

        return { ...iv, sessions: list }
      })
      // フィルタ適用中はマッチセッション0件のグループを非表示
      .filter((iv) => {
        const isFiltering = q !== '' || statusFilter !== 'all'
        return isFiltering ? iv.sessions.length > 0 : true
      })
  }, [interviews, sessions, searchQuery, statusFilter, sortKey])

  const doneCount = sessions.filter((s) => s.status === 'done').length
  const isFiltering = searchQuery !== '' || statusFilter !== 'all'
  const totalFiltered = grouped.reduce((n, iv) => n + iv.sessions.length, 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold text-indigo-400">UserVoice</Link>
          <span className="text-gray-500">/</span>
          <span className="text-gray-300">ダッシュボード</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/design"
            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            ✨ AIで質問設計
          </Link>
          <button
            onClick={() => setShowCreateInterview(true)}
            className="border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            + 手動で作成
          </button>
          <Link
            href="/dashboard/settings/members"
            className="border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            👥 メンバー管理
          </Link>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              window.location.href = '/login'
            }}
            className="border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ログアウト
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* サマリーカード */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <StatCard value={interviews.length} label="インタビューテンプレート" />
          <StatCard value={sessions.length} label="総セッション数" />
          <StatCard value={doneCount} label="分析完了" />
        </div>

        <div>
          {/* グループ一覧 */}
          <div>

            {/* ── ツールバー ── */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {/* 検索 */}
              <div className="relative flex-1 min-w-40">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="参加者名で検索..."
                  className="w-full bg-gray-900 border border-gray-700 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* ステータスフィルタ */}
              <div className="flex gap-1">
                {(['all', 'pending', 'active', 'done'] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === s
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-900 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>

              {/* ソート */}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {/* フィルタ中の件数表示 & リセット */}
              {isFiltering && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{totalFiltered} 件表示</span>
                  <button
                    onClick={() => { setSearchQuery(''); setStatusFilter('all') }}
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    リセット
                  </button>
                </div>
              )}
            </div>

            {/* ── グループ一覧 ── */}
            <div className="space-y-4">
              {grouped.length === 0 ? (
                <div className="p-8 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
                  {isFiltering
                    ? '条件に一致するセッションがありません'
                    : 'インタビューがありません。「+ インタビュー作成」から始めましょう。'}
                </div>
              ) : (
                grouped.map((iv) => {
                  const isCollapsed = collapsed.has(iv.id)
                  // 全セッションに対するこのグループの件数（フィルタ前）
                  const totalInGroup = sessions.filter((s) => s.interview.id === iv.id).length

                  return (
                    <div key={iv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                      {/* インタビューヘッダー */}
                      <div className="px-4 py-3 flex items-center justify-between gap-2">
                        {/* 左: 折りたたみトグル ＋ タイトル（比較ビューへのリンク） */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <button
                            onClick={() => toggleCollapse(iv.id)}
                            className="text-gray-500 hover:text-gray-300 transition-colors text-xs flex-shrink-0 w-4"
                            title={isCollapsed ? '展開' : '折りたたむ'}
                          >
                            <span className={`inline-block transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}>
                              ▼
                            </span>
                          </button>
                          <Link
                            href={`/dashboard/interviews/${iv.id}`}
                            className="flex items-center gap-2 min-w-0 group"
                          >
                            <span className="font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                              {iv.title}
                            </span>
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              {isFiltering
                                ? <>{iv.sessions.length} <span className="text-gray-700">/ {totalInGroup}</span></>
                                : <>{iv.sessions.length} セッション</>
                              }
                            </span>
                          </Link>
                        </div>

                        {/* 右: 招待リンク */}
                        <button
                          onClick={(e) => copyInviteLink(iv.id, e)}
                          className="border border-gray-700 hover:border-indigo-500 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-indigo-300 transition-colors flex-shrink-0"
                          title="この URL を参加者に共有すると、名前を入力するだけで自動的にセッションが作成されます"
                        >
                          {copiedInviteId === iv.id ? '✓ コピー済み' : '🔗 招待リンク'}
                        </button>
                      </div>

                      {iv.description && !isCollapsed && (
                        <div className="px-4 pb-2">
                          <p className="text-xs text-gray-500">{iv.description}</p>
                        </div>
                      )}

                      {/* セッション行 */}
                      {!isCollapsed && (
                        <div className="border-t border-gray-800">
                          {iv.sessions.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-gray-600 text-center">
                              {isFiltering ? '条件に一致するセッションなし' : 'セッションがありません'}
                            </div>
                          ) : (
                            <div className="divide-y divide-gray-800/60">
                              {iv.sessions.map((s) => (
                                <div key={s.id} className="relative group">
                                  <Link
                                    href={`/dashboard/sessions/${s.id}`}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
                                  >
                                    <span className="text-sm font-medium text-gray-200 w-32 flex-shrink-0 truncate">
                                      {s.participant?.name ?? 'Anonymous'}
                                    </span>
                                    {s.transcript?.summary ? (
                                      <span className="hidden lg:block text-xs text-gray-500 flex-1 truncate">
                                        {s.transcript.summary}
                                      </span>
                                    ) : (
                                      <span className="flex-1" />
                                    )}
                                    <span className="text-xs text-gray-600 flex-shrink-0">
                                      {new Date(s.createdAt).toLocaleDateString('ja-JP')}
                                    </span>
                                    <StatusBadge status={s.status} />
                                  </Link>

                                  {/* URL コピー */}
                                  {(s.status === 'pending' || s.status === 'active') && (
                                    <button
                                      onClick={(e) => copyInterviewUrl(s, e)}
                                      className="absolute top-1/2 -translate-y-1/2 right-3 bg-gray-800 hover:bg-indigo-700 border border-gray-700 px-2.5 py-1 rounded-lg text-xs text-gray-300 hover:text-white transition-colors"
                                    >
                                      {copiedId === s.id ? '✓ コピー済み' : '🔗 URL'}
                                    </button>
                                  )}

                                  {/* 削除 */}
                                  {(s.status === 'done' || s.status === 'completed') && (
                                    confirmDeleteId === s.id ? (
                                      <div
                                        className="absolute top-1/2 -translate-y-1/2 right-3 flex items-center gap-1.5"
                                        onClick={(e) => e.preventDefault()}
                                      >
                                        <span className="text-xs text-gray-400">削除しますか？</span>
                                        <button
                                          onClick={(e) => deleteSession(s.id, e)}
                                          disabled={deletingId === s.id}
                                          className="bg-red-700 hover:bg-red-600 disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs text-white transition-colors"
                                        >
                                          {deletingId === s.id ? '削除中...' : '削除'}
                                        </button>
                                        <button
                                          onClick={(e) => { e.preventDefault(); setConfirmDeleteId(null) }}
                                          className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1 rounded-lg text-xs text-gray-300 transition-colors"
                                        >
                                          キャンセル
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.preventDefault(); setConfirmDeleteId(s.id) }}
                                        className="absolute top-1/2 -translate-y-1/2 right-3 opacity-0 group-hover:opacity-100 bg-gray-800 hover:bg-red-900 border border-gray-700 hover:border-red-700 p-1.5 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                                        title="セッションを削除"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="3 6 5 6 21 6" />
                                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                          <path d="M10 11v6M14 11v6" />
                                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                        </svg>
                                      </button>
                                    )
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

        </div>
      </div>

      {showCreateInterview && (
        <CreateInterviewModal
          onClose={() => setShowCreateInterview(false)}
          onCreated={() => { fetchData(); setShowCreateInterview(false) }}
        />
      )}
    </div>
  )
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="text-3xl font-bold text-indigo-400 mb-1">{value}</div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  )
}

