'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'

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
  happy: 'text-green-400', neutral: 'text-gray-400',
  sad: 'text-blue-400', surprised: 'text-orange-400',
}

export default function InterviewComparePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params)
  const [data, setData] = useState<CompareData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/interviews/${id}/compare`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    )
  }
  if (!data) return null

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
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="text-indigo-400 hover:text-indigo-300">UserVoice</Link>
          <span className="text-gray-600">/</span>
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-300">ダッシュボード</Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-300">{interview.title}</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* ヘッダー */}
        <div>
          <h1 className="text-2xl font-bold mb-1">{interview.title}</h1>
          <p className="text-gray-400 text-sm">
            分析済みセッション {sessions.length} 件 · 質問 {interview.questions.length} 問
          </p>
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
            分析済みのセッションがありません。インタビューを実施して AI 分析を完了させてください。
          </div>
        ) : (
          <>
            {/* 共通インサイト */}
            {commonInsights && (
              <div className="bg-indigo-950/50 border border-indigo-800 rounded-xl p-6">
                <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-3">
                  AI 共通インサイト（全参加者）
                </h2>
                <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">
                  {commonInsights}
                </div>
              </div>
            )}

            {/* テーマ頻度 */}
            {sortedThemes.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
                  テーマ出現頻度
                </h2>
                <div className="flex flex-wrap gap-2">
                  {sortedThemes.map(([theme, count]) => (
                    <span
                      key={theme}
                      className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-full text-sm"
                    >
                      <span className="text-indigo-400 font-semibold">{count}</span>
                      <span className="text-gray-300">{theme}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 参加者比較テーブル */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">参加者比較</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">参加者</th>
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">主要テーマ</th>
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">主な感情</th>
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">サマリー</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-6 py-4 font-medium whitespace-nowrap">{s.participantName}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {s.themes?.split(',').slice(0, 3).map((t, i) => (
                              <span key={i} className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-xs">
                                {t.trim()}
                              </span>
                            )) ?? <span className="text-gray-600">—</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {s.dominantEmotion ? (
                            <span className={`font-medium ${EMOTION_COLORS[s.dominantEmotion] ?? 'text-gray-400'}`}>
                              {EMOTION_LABELS[s.dominantEmotion] ?? s.dominantEmotion}
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-gray-400 text-xs line-clamp-2">{s.summary ?? '—'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            href={`/dashboard/sessions/${s.id}`}
                            className="text-indigo-400 hover:text-indigo-300 text-xs whitespace-nowrap"
                          >
                            詳細 →
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
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
                  感情プロファイル比較
                </h2>
                <div className="flex gap-4 justify-center flex-wrap mb-4">
                  {sessions.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-2 text-xs text-gray-400">
                      <span
                        className="w-3 h-3 rounded-full inline-block"
                        style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }}
                      />
                      {s.participantName}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#374151" />
                    <PolarAngleAxis dataKey="emotion" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
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
    </div>
  )
}

const RADAR_COLORS = ['#6366f1', '#34d399', '#fb923c', '#f472b6', '#a78bfa']
