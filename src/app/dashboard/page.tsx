'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics'
import CreateInterviewModal from '@/components/CreateInterviewModal'
import StatusBadge from '@/components/StatusBadge'
import {
  Search,
  X,
  ChevronDown,
  Sparkles,
  Plus,
  Users,
  LogOut,
  Mail,
  Link2,
  Check,
  Trash2,
} from 'lucide-react'

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
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date-desc')

  const [loadError, setLoadError] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      const [ivRes, svRes] = await Promise.all([
        fetch('/api/interviews'),
        fetch('/api/sessions'),
      ])
      // 未認証ならログインへ
      if (ivRes.status === 401 || svRes.status === 401) {
        window.location.href = '/login'
        return
      }
      if (!ivRes.ok || !svRes.ok) throw new Error('failed')
      const iv = await ivRes.json()
      const sv = await svRes.json()
      setInterviews(Array.isArray(iv) ? iv : [])
      setSessions(Array.isArray(sv) ? sv : [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
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
    track('invite_copied', { interviewId })
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

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return interviews
      .map((iv) => {
        let list = sessions.filter((s) => s.interview.id === iv.id)

        if (q) {
          list = list.filter((s) =>
            (s.participant?.name ?? 'anonymous').toLowerCase().includes(q)
          )
        }

        if (statusFilter !== 'all') {
          list = list.filter((s) => s.status === statusFilter)
        }

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
      .filter((iv) => {
        const isFiltering = q !== '' || statusFilter !== 'all'
        return isFiltering ? iv.sessions.length > 0 : true
      })
  }, [interviews, sessions, searchQuery, statusFilter, sortKey])

  const doneCount = sessions.filter((s) => s.status === 'done').length
  const isFiltering = searchQuery !== '' || statusFilter !== 'all'
  const totalFiltered = grouped.reduce((n, iv) => n + iv.sessions.length, 0)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="text-base font-semibold tracking-tight text-gray-900">
            UserVoice
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-600 text-sm">ダッシュボード</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/design"
            className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
            AIで質問設計
          </Link>
          <button
            onClick={() => setShowCreateInterview(true)}
            className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md text-sm text-gray-700 hover:text-gray-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            手動で作成
          </button>
          <Link
            href="/dashboard/settings/members"
            className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md text-xs text-gray-600 hover:text-gray-900 transition-colors"
          >
            <Users className="w-3.5 h-3.5" strokeWidth={2} />
            メンバー
          </Link>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              window.location.href = '/login'
            }}
            className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
            ログアウト
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {loadError && (
          <div className="mb-6 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <span className="text-sm text-red-700">データの読み込みに失敗しました。</span>
            <button
              onClick={() => fetchData()}
              className="ml-4 flex-shrink-0 border border-red-300 hover:border-red-400 text-red-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              再試行
            </button>
          </div>
        )}
        {/* サマリーカード */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <StatCard value={interviews.length} label="インタビューテンプレート" />
          <StatCard value={sessions.length} label="総セッション数" />
          <StatCard value={doneCount} label="分析完了" />
        </div>

        {/* ツールバー */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="参加者名で検索"
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-md">
            {(['all', 'pending', 'active', 'done'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-white border border-gray-300 text-gray-700 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-gray-900 transition-colors"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {isFiltering && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{totalFiltered} 件</span>
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all') }}
                className="text-gray-700 hover:text-gray-900 underline underline-offset-2"
              >
                リセット
              </button>
            </div>
          )}
        </div>

        {/* グループ一覧 */}
        <div className="space-y-3">
          {grouped.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
              {isFiltering
                ? '条件に一致するセッションがありません'
                : 'インタビューがありません。「手動で作成」または「AIで質問設計」から始めましょう。'}
            </div>
          ) : (
            grouped.map((iv) => {
              const isCollapsed = collapsed.has(iv.id)
              const totalInGroup = sessions.filter((s) => s.interview.id === iv.id).length

              return (
                <div key={iv.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  {/* インタビューヘッダー */}
                  <div className="px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        onClick={() => toggleCollapse(iv.id)}
                        className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0"
                        title={isCollapsed ? '展開' : '折りたたむ'}
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                          strokeWidth={2}
                        />
                      </button>
                      <Link
                        href={`/dashboard/interviews/${iv.id}`}
                        className="flex items-center gap-2 min-w-0 group"
                      >
                        <span className="font-medium text-sm text-gray-900 group-hover:text-gray-600 transition-colors truncate">
                          {iv.title}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {isFiltering
                            ? <>{iv.sessions.length} <span className="text-gray-300">/ {totalInGroup}</span></>
                            : <>{iv.sessions.length} セッション</>
                          }
                        </span>
                      </Link>
                    </div>

                    <button
                      onClick={(e) => copyInviteLink(iv.id, e)}
                      className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-900 px-2.5 py-1 rounded-md text-xs text-gray-700 hover:text-gray-900 transition-colors flex-shrink-0"
                      title="参加者に送るリンクをコピーします。このリンクを開いた人が名前を入力すると、新しいセッションが自動作成されます。複数人に同じリンクを送れます。"
                    >
                      {copiedInviteId === iv.id ? (
                        <><Check className="w-3 h-3" strokeWidth={2.5} /> コピー済み</>
                      ) : (
                        <><Mail className="w-3 h-3" strokeWidth={2} /> 参加者を招待</>
                      )}
                    </button>
                  </div>

                  {iv.description && !isCollapsed && (
                    <div className="px-4 pb-2 pl-10">
                      <p className="text-xs text-gray-500">{iv.description}</p>
                    </div>
                  )}

                  {/* セッション行 */}
                  {!isCollapsed && (
                    <div className="border-t border-gray-100">
                      {iv.sessions.length === 0 ? (
                        <div className="px-4 py-4 text-sm text-gray-400 text-center">
                          {isFiltering ? '条件に一致するセッションなし' : 'セッションがありません'}
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {iv.sessions.map((s) => (
                            <div key={s.id} className="relative group">
                              <Link
                                href={`/dashboard/sessions/${s.id}`}
                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                              >
                                <span className="text-sm font-medium text-gray-900 w-32 flex-shrink-0 truncate">
                                  {s.participant?.name ?? 'Anonymous'}
                                </span>
                                {s.transcript?.summary ? (
                                  <span className="hidden lg:block text-xs text-gray-500 flex-1 truncate">
                                    {s.transcript.summary}
                                  </span>
                                ) : (
                                  <span className="flex-1" />
                                )}
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                  {new Date(s.createdAt).toLocaleDateString('ja-JP')}
                                </span>
                                <StatusBadge status={s.status} />
                              </Link>

                              {(s.status === 'pending' || s.status === 'active') && (
                                <button
                                  onClick={(e) => copyInterviewUrl(s, e)}
                                  className="absolute top-1/2 -translate-y-1/2 right-3 inline-flex items-center gap-1 bg-white hover:bg-gray-900 hover:text-white border border-gray-300 hover:border-gray-900 px-2 py-1 rounded-md text-xs text-gray-700 transition-colors"
                                  title="このセッション専用のURLです。特定の参加者に直接送ると、名前入力なしでインタビューをすぐ開始できます"
                                >
                                  {copiedId === s.id ? (
                                    <><Check className="w-3 h-3" strokeWidth={2.5} /> コピー済み</>
                                  ) : (
                                    <><Link2 className="w-3 h-3" strokeWidth={2} /> このセッションのURL</>
                                  )}
                                </button>
                              )}

                              {(s.status === 'done' || s.status === 'completed') && (
                                confirmDeleteId === s.id ? (
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 right-3 flex items-center gap-1.5 bg-white"
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    <span className="text-xs text-gray-600">削除しますか？</span>
                                    <button
                                      onClick={(e) => deleteSession(s.id, e)}
                                      disabled={deletingId === s.id}
                                      className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 rounded-md text-xs transition-colors"
                                    >
                                      {deletingId === s.id ? '削除中...' : '削除'}
                                    </button>
                                    <button
                                      onClick={(e) => { e.preventDefault(); setConfirmDeleteId(null) }}
                                      className="bg-white border border-gray-300 hover:border-gray-400 px-2 py-1 rounded-md text-xs text-gray-700 transition-colors"
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.preventDefault(); setConfirmDeleteId(s.id) }}
                                    className="absolute top-1/2 -translate-y-1/2 right-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-300 p-1.5 rounded-md text-gray-400 hover:text-red-600 transition-all"
                                    title="セッションを削除"
                                    aria-label="セッションを削除"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
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
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-2xl font-semibold text-gray-900 mb-0.5 tracking-tight">{value}</div>
      <div className="text-gray-500 text-xs">{label}</div>
    </div>
  )
}
