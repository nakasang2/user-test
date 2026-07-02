'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import FloatingAgentChat from '@/components/FloatingAgentChat'

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
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/interviews/${id}/compare`)
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        if (r.status === 404) { setLoadError('インタビューが見つかりません。削除されたか、閲覧権限がない可能性があります。'); return null }
        if (!r.ok) { setLoadError('データの取得に失敗しました。'); return null }
        return r.json()
      })
      .then((d) => d && setData(d))
      .catch(() => setLoadError('ネットワークエラーが発生しました。'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    )
  }
  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-gray-900 font-medium mb-1.5">表示できません</p>
          <p className="text-gray-500 text-sm mb-4">{loadError ?? 'データの取得に失敗しました。'}</p>
          <Link href="/dashboard" className="text-sm text-gray-700 hover:text-gray-900 underline underline-offset-2">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    )
  }

  const { interview, sessions, commonInsights } = data

  // レーダーチャート用データ（参加者ごとの感情平均）
  const radarData = ['happy', 'neutral', 'sad', 'surprised'].map((emotion) => ({
    emotion: EMOTION_LABELS[emotion],
    ...Object.fromEntries(
      sessions.map((s) => [
        s.participantName,
        s.avgEmotion ? Math.round((s.avgEmotion[emotion as keyof typeof s.avgEmotion] ?? 0) * 100) : 0,
      ])
    ),
  }))

  // テーマの出現頻度を集計
  const themeCount: Record<string, number> = {}
  sessions.forEach((s) => {
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
            分析済みセッション {sessions.length} 件 · 質問 {interview.questions.length} 問
          </p>
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
            分析済みのセッションがありません。インタビューを実施して AI 分析を完了させてください。
          </div>
        ) : (
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
                    {sessions.map((s) => (
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
            {sessions.some((s) => s.avgEmotion) && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
                  感情プロファイル比較
                </h2>
                <div className="flex gap-3 justify-center flex-wrap mb-4">
                  {sessions.map((s, i) => (
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
                    {sessions.map((s, i) => (
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
