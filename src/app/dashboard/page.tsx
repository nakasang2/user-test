'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics'
import CreateInterviewModal from '@/components/CreateInterviewModal'
import StatusBadge from '@/components/StatusBadge'
import BulkDeleteModal from '@/components/BulkDeleteModal'
import {
  Search,
  X,
  Plus,
  Users,
  LogOut,
  Mail,
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
  type: string
  questions: Question[]
  _count: { sessions: number }
  createdAt: string
}

type TypeFilter = 'all' | 'interview' | 'impression' | 'usability'
const TYPE_LABELS: Record<string, string> = {
  all: 'すべて', interview: 'インタビュー', impression: '印象テスト', usability: 'ユーザビリティ',
}

interface Session {
  id: string
  status: string
  isPilot?: boolean
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)

  // 一覧の複数選択・一括削除
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
    } finally {
      setLoading(false)
    }
  }

  async function copyInviteLink(interviewId: string, e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}/join/${interviewId}`
    try {
      await navigator.clipboard.writeText(url)
      track('invite_copied', { interviewId })
      setCopiedInviteId(interviewId)
      setTimeout(() => setCopiedInviteId(null), 2000)
    } catch {
      // クリップボードが使えない環境（非HTTPS等）のフォールバック
      window.prompt('以下のリンクをコピーしてください', url)
    }
  }

  // パイロット（リサーチャーの試行）は本番の実績ではないので、件数からは除く。
  // 調査詳細側の集計と数字が食い違わないよう、ここでも同じ基準で数える。
  const realSessions = useMemo(() => sessions.filter((s) => !s.isPilot), [sessions])

  // インタビュー(テスト)ごとのセッション集計
  const countsByInterview = useMemo(() => {
    const m: Record<string, { total: number; done: number }> = {}
    for (const s of realSessions) {
      const k = s.interview.id
      if (!m[k]) m[k] = { total: 0, done: 0 }
      m[k].total++
      if (s.status === 'done') m[k].done++
    }
    return m
  }, [realSessions])

  // テスト一覧（テスト名で検索＋タイプ絞り込み＋並び替え）
  const visibleInterviews = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return interviews
      .filter((iv) => (q ? iv.title.toLowerCase().includes(q) : true))
      .filter((iv) => (typeFilter === 'all' ? true : iv.type === typeFilter))
      .slice()
      .sort((a, b) => {
        if (sortKey === 'name-asc') return a.title.localeCompare(b.title, 'ja')
        if (sortKey === 'sessions-desc') return (countsByInterview[b.id]?.total ?? 0) - (countsByInterview[a.id]?.total ?? 0)
        const da = new Date(a.createdAt).getTime(), db = new Date(b.createdAt).getTime()
        return sortKey === 'date-asc' ? da - db : db - da
      })
  }, [interviews, searchQuery, typeFilter, sortKey, countsByInterview])

  // 選択されているのに、絞り込みで見えなくなった id は選択解除する
  // （見えない項目を「削除される」と気づけないまま実行してしまうのを防ぐ）
  const visibleIdSet = useMemo(() => new Set(visibleInterviews.map((iv) => iv.id)), [visibleInterviews])
  const selectedVisible = useMemo(
    () => [...selectedIds].filter((id) => visibleIdSet.has(id)),
    [selectedIds, visibleIdSet]
  )

  async function bulkDelete() {
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/interviews/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedVisible }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        alert(
          res.status === 403
            ? '削除する権限がありません（管理者以上が必要です）。'
            : (data?.error ?? '削除に失敗しました')
        )
        return
      }
      const ng = data.failed?.length > 0
        ? `\n${data.failed.length} 件は削除できませんでした（${data.failed.map((f: { error: string }) => f.error).join(' / ')}）。`
        : ''
      setBulkDeleteOpen(false)
      setSelectedIds(new Set())
      await fetchData()
      if (ng) alert(`${data.deleted?.length ?? 0} 件を削除しました。${ng}`)
    } catch {
      alert('削除に失敗しました')
    } finally {
      setBulkDeleting(false)
    }
  }

  const doneCount = realSessions.filter((s) => s.status === 'done').length

  // 直近のセッション。/api/sessions は既に取得しているのに件数にしか使っておらず、
  // 「新しく完了した分」に気づく導線が無かった（通知も無いので、ここが起点になる）。
  const recentSessions = useMemo(
    () =>
      realSessions
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [realSessions]
  )

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setShowCreateInterview(true)}
            className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            新規作成
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <StatCard value={interviews.length} label="テスト数" />
          <StatCard value={realSessions.length} label="総セッション数" />
          <StatCard value={doneCount} label="分析完了" />
        </div>

        {/* 直近のセッション。テストを1つずつ開かなくても新着に気づけるようにする */}
        {!loading && recentSessions.length > 0 && (
          <div className="mb-8 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">最近のセッション</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {recentSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/dashboard/sessions/${s.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm text-gray-900 w-32 flex-shrink-0 truncate">
                    {s.participant?.name ?? 'Anonymous'}
                  </span>
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-gray-500 flex-1 truncate">{s.interview.title}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {new Date(s.createdAt).toLocaleDateString('ja-JP')}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ツールバー（テスト名で検索＋タイプ絞り込み＋並び替え） */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="テスト名で検索"
              className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
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
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="bg-white border border-gray-300 text-gray-700 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-gray-900 transition-colors"
          >
            {(['all', 'interview', 'impression', 'usability'] as TypeFilter[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>

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

        {/* 選択バー。1件以上選ぶと現れる */}
        {!loading && visibleInterviews.length > 0 && (
          <div className="flex items-center gap-2 mb-3 text-xs text-gray-600">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedVisible.length > 0 && selectedVisible.length === visibleInterviews.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleInterviews.length
                }}
                onChange={(e) => {
                  setSelectedIds(e.target.checked ? new Set(visibleInterviews.map((iv) => iv.id)) : new Set())
                }}
                className="accent-gray-900"
              />
              すべて選択
            </label>
            {selectedVisible.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span>{selectedVisible.length} 件選択中</span>
                <button
                  onClick={() => setBulkDeleteOpen(true)}
                  className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-medium ml-1"
                >
                  <Trash2 className="w-3 h-3" strokeWidth={2} />
                  削除
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-gray-500 hover:text-gray-900 underline underline-offset-2">
                  選択を解除
                </button>
              </>
            )}
          </div>
        )}

        {/* テスト一覧 */}
        <div className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : visibleInterviews.length === 0 ? (
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
                  <input
                    type="checkbox"
                    checked={selectedIds.has(iv.id)}
                    onChange={() => toggleSelect(iv.id)}
                    aria-label={`${iv.title} を選択`}
                    className="mt-1 flex-shrink-0 accent-gray-900"
                  />
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
                      <span className="text-gray-500">{new Date(iv.createdAt).toLocaleDateString('ja-JP')}</span>
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

      {bulkDeleteOpen && (
        <BulkDeleteModal
          itemLabel="テスト"
          items={visibleInterviews.filter((iv) => selectedIds.has(iv.id)).map((iv) => ({ id: iv.id, label: iv.title }))}
          detailNote="配下のセッション（録画・文字起こし・回答）と、調査に使った画像もすべてサーバーから削除されます。"
          deleting={bulkDeleting}
          onConfirm={bulkDelete}
          onClose={() => setBulkDeleteOpen(false)}
        />
      )}

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
