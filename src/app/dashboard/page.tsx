'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics'
import CreateInterviewModal from '@/components/CreateInterviewModal'
import {
  Search,
  X,
  Sparkles,
  Plus,
  Users,
  LogOut,
  Mail,
  Check,
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

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'sessions-desc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date-desc',     label: '新しい順'    },
  { value: 'date-asc',      label: '古い順'      },
  { value: 'name-asc',      label: 'テスト名順'  },
  { value: 'sessions-desc', label: 'セッション数順' },
]

export default function Dashboard() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showCreateInterview, setShowCreateInterview] = useState(false)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
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

  async function copyInviteLink(interviewId: string, e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}/join/${interviewId}`
    await navigator.clipboard.writeText(url)
    track('invite_copied', { interviewId })
    setCopiedInviteId(interviewId)
    setTimeout(() => setCopiedInviteId(null), 2000)
  }

  // インタビュー(テスト)ごとのセッション集計
  const countsByInterview = useMemo(() => {
    const m: Record<string, { total: number; done: number }> = {}
    for (const s of sessions) {
      const k = s.interview.id
      if (!m[k]) m[k] = { total: 0, done: 0 }
      m[k].total++
      if (s.status === 'done') m[k].done++
    }
    return m
  }, [sessions])

  // テスト一覧（テスト名で検索＋並び替え）
  const visibleInterviews = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return interviews
      .filter((iv) => (q ? iv.title.toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => {
        if (sortKey === 'name-asc') return a.title.localeCompare(b.title, 'ja')
        if (sortKey === 'sessions-desc') return (countsByInterview[b.id]?.total ?? 0) - (countsByInterview[a.id]?.total ?? 0)
        const da = new Date(a.createdAt).getTime(), db = new Date(b.createdAt).getTime()
        return sortKey === 'date-asc' ? da - db : db - da
      })
  }, [interviews, searchQuery, sortKey, countsByInterview])

  const doneCount = sessions.filter((s) => s.status === 'done').length

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
          <StatCard value={interviews.length} label="テスト数" />
          <StatCard value={sessions.length} label="総セッション数" />
          <StatCard value={doneCount} label="分析完了" />
        </div>

        {/* ツールバー（テスト名で検索＋並び替え） */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="テスト名で検索"
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="検索をクリア"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
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
        </div>

        {/* テスト一覧 */}
        <div className="space-y-3">
          {visibleInterviews.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
              {searchQuery.trim()
                ? '条件に一致するテストがありません'
                : 'テストがありません。「手動で作成」または「AIで質問設計」から始めましょう。'}
            </div>
          ) : (
            visibleInterviews.map((iv) => {
              const c = countsByInterview[iv.id] ?? { total: 0, done: 0 }
              return (
                <div
                  key={iv.id}
                  className="bg-white border border-gray-200 hover:border-gray-300 rounded-lg p-4 flex items-start justify-between gap-3 transition-colors"
                >
                  <Link href={`/dashboard/interviews/${iv.id}`} className="min-w-0 flex-1 group">
                    <span className="block font-medium text-sm text-gray-900 group-hover:text-gray-600 transition-colors truncate mb-0.5">
                      {iv.title}
                    </span>
                    {iv.description && (
                      <p className="text-xs text-gray-500 truncate mb-1.5">{iv.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{c.total} セッション</span>
                      <span className="text-gray-300">·</span>
                      <span>分析済み {c.done}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-400">{new Date(iv.createdAt).toLocaleDateString('ja-JP')}</span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => copyInviteLink(iv.id, e)}
                      className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-900 px-2.5 py-1 rounded-md text-xs text-gray-700 hover:text-gray-900 transition-colors"
                      title="参加者に送る招待リンクをコピー（開いた人が名前を入力すると新しいセッションが作成されます）"
                    >
                      {copiedInviteId === iv.id ? (
                        <><Check className="w-3 h-3" strokeWidth={2.5} /> コピー済み</>
                      ) : (
                        <><Mail className="w-3 h-3" strokeWidth={2} /> 招待</>
                      )}
                    </button>
                    <Link
                      href={`/dashboard/interviews/${iv.id}`}
                      className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                    >
                      結果を見る
                    </Link>
                  </div>
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
