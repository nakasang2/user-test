'use client'

import { useState, useEffect, use, useMemo } from 'react'
import Link from 'next/link'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { Search, X } from 'lucide-react'
import FloatingAgentChat from '@/components/FloatingAgentChat'
import StatusBadge from '@/components/StatusBadge'

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'status'
type StatusFilter = 'all' | 'pending' | 'active' | 'done' | 'completed'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date-desc', label: '新しい順' },
  { value: 'date-asc', label: '古い順' },
  { value: 'name-asc', label: '参加者名順' },
  { value: 'status', label: 'ステータス順' },
]
const STATUS_LABELS: Record<string, string> = {
  all: 'すべて', pending: '待機中', active: '進行中', done: '分析済み', completed: '完了',
}

interface SessionStat {
  id: string
  participantName: string
  status: string
  createdAt: string
  summary: string | null
  themes: string | null
  dominantEmotion: string | null
  avgEmotion: { happy: number; neutral: number; sad: number; surprised: number } | null
  segmentCount: number
}

interface CompareData {
  interview: {
    id: string
    title: string
    description: string | null
    questions: { id: string; text: string; order: number; type: string }[]
  }
  sessions: SessionStat[]
  commonInsights: string | null
}

const EMOTION_LABELS: Record<string, string> = {
  happy: '喜び', neutral: '中立', sad: '悲しみ', surprised: '驚き',
  angry: '怒り', fearful: '恐怖', disgusted: '嫌悪',
}

const EMOTION_COLORS: Record<string, string> = {
  happy: 'text-emerald-700', neutral: 'text-gray-600',
  sad: 'text-blue-700', surprised: 'text-orange-700',
}

export default function InterviewComparePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params)
  const [data, setData] = useState<CompareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 個別結果一覧のソート/フィルタ
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date-desc')

  const visibleSessions = useMemo(() => {
    const STATUS_ORDER: Record<string, number> = { active: 0, pending: 1, done: 2, completed: 3 }
    return (data?.sessions ?? [])
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) => (search.trim() ? s.participantName.toLowerCase().includes(search.trim().toLowerCase()) : true))
      .slice()
      .sort((a, b) => {
        if (sortKey === 'name-asc') return a.participantName.localeCompare(b.participantName, 'ja')
        if (sortKey === 'status') return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        const da = new Date(a.createdAt).getTime(), db = new Date(b.createdAt).getTime()
        return sortKey === 'date-asc' ? da - db : db - da
      })
  }, [data, statusFilter, search, sortKey])
  const isFiltering = statusFilter !== 'all' || search.trim() !== ''

  useEffect(() => {
    let cancelled = false
    fetch(`/api/interviews/${id}/compare`)
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        if (!r.ok) throw new Error('failed')
        return r.json()
      })
      .then((d) => { if (!cancelled && d) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <div className="text-gray-700 text-sm">データの読み込みに失敗しました。</div>
        <button
          onClick={() => window.location.reload()}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors"
        >
          再試行
        </button>
      </div>
    )
  }

  const { interview, sessions, commonInsights } = data
  // 分析系（インサイト・テーマ・比較・レーダー）は分析済み(done)のみで算出
  const doneSessions = sessions.filter((s) => s.status === 'done')

  // レーダーチャート用データ（参加者ごとの感情平均）
  const radarData = ['happy', 'neutral', 'sad', 'surprised'].map((emotion) => ({
    emotion: EMOTION_LABELS[emotion],
    ...Object.fromEntries(
      doneSessions.map((s) => [
        s.participantName,
        s.avgEmotion ? Math.round((s.avgEmotion[emotion as keyof typeof s.avgEmotion] ?? 0) * 100) : 0,
      ])
    ),
  }))

  // テーマの出現頻度を集計
  const themeCount: Record<string, number> = {}
  doneSessions.forEach((s) => {
    s.themes?.split(',').forEach((t) => {
      const key = t.trim()
      if (key) themeCount[key] = (themeCount[key] ?? 0) + 1
    })
  })
  const sortedThemes = Object.entries(themeCount).sort(([, a], [, b]) => b - a)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="font-semibold tracking-tight text-gray-900">UserVoice</Link>
          <span className="text-gray-300">/</span>
          <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">ダッシュボード</Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900">{interview.title}</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* ヘッダー */}
        <div>
          <h1 className="text-2xl font-semibold mb-1 tracking-tight text-gray-900">{interview.title}</h1>
          <p className="text-gray-500 text-sm">
            セッション {sessions.length} 件（分析済み {doneSessions.length} 件） · 質問 {interview.questions.length} 問
          </p>
        </div>

        {/* 個別の結果一覧（全ステータス・ソート/フィルタ/検索） */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-auto">個別の結果</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="参加者名で検索"
                className="bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-md">
              {(['all', 'pending', 'active', 'done', 'completed'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
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
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {visibleSessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {isFiltering ? '条件に一致する結果がありません' : 'まだセッションがありません。招待リンクを参加者に送りましょう。'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visibleSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/dashboard/sessions/${s.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium text-sm text-gray-900 w-36 flex-shrink-0 truncate">{s.participantName}</span>
                  <StatusBadge status={s.status} />
                  <span className="hidden md:block text-xs text-gray-500 flex-1 truncate">{s.summary ?? '—'}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-auto">{new Date(s.createdAt).toLocaleDateString('ja-JP')}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {doneSessions.length === 0 ? null : (
          <>
            {/* 共通インサイト */}
            {commonInsights && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                  AI 共通インサイト（全参加者）
                </h2>
                <div className="text-sm text-gray-900 leading-relaxed whitespace-pre-line">
                  {commonInsights}
                </div>
              </div>
            )}

            {/* テーマ頻度 */}
            {sortedThemes.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
                  テーマ出現頻度
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {sortedThemes.map(([theme, count]) => (
                    <span
                      key={theme}
                      className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-md text-xs"
                    >
                      <span className="text-gray-900 font-semibold">{count}</span>
                      <span className="text-gray-600">{theme}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 参加者比較テーブル */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-200">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">参加者比較</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">参加者</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">主要テーマ</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">主な感情</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">サマリー</th>
                      <th className="px-6 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {doneSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">{s.participantName}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap gap-1">
                            {s.themes?.split(',').slice(0, 3).map((t, i) => (
                              <span key={i} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs">
                                {t.trim()}
                              </span>
                            )) ?? <span className="text-gray-400">—</span>}
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          {s.dominantEmotion ? (
                            <span className={`font-medium text-sm ${EMOTION_COLORS[s.dominantEmotion] ?? 'text-gray-600'}`}>
                              {EMOTION_LABELS[s.dominantEmotion] ?? s.dominantEmotion}
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-6 py-3 max-w-xs">
                          <p className="text-gray-500 text-xs line-clamp-2">{s.summary ?? '—'}</p>
                        </td>
                        <td className="px-6 py-3">
                          <Link
                            href={`/dashboard/sessions/${s.id}`}
                            className="text-gray-900 hover:text-gray-700 text-xs font-medium whitespace-nowrap underline underline-offset-2"
                          >
                            詳細
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 感情レーダーチャート */}
            {doneSessions.some((s) => s.avgEmotion) && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
                  感情プロファイル比較
                </h2>
                <div className="flex gap-3 justify-center flex-wrap mb-4">
                  {doneSessions.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }}
                      />
                      {s.participantName}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="emotion" tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v) => `${v ?? 0}%`}
                    />
                    {doneSessions.map((s, i) => (
                      <Radar
                        key={s.id}
                        name={s.participantName}
                        dataKey={s.participantName}
                        stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>

      {/* フローティング AI チャット（このインタビュー全体について質問） */}
      <FloatingAgentChat interviewId={id} />
    </div>
  )
}

const RADAR_COLORS = ['#1f2937', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
