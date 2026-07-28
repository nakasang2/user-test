'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, X, Loader2 } from 'lucide-react'

interface Hit {
  id: string
  text: string
  speaker: string
  startTime: number
}

interface SearchResult {
  sessionId: string
  participantName: string
  hits: Hit[]
}

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

const speakerLabel = (s: string) =>
  s === 'Interviewer' ? 'AI' : s === 'Participant' ? '参加者' : s === 'System' ? 'タスク記録' : s

/**
 * インタビュー横断の発言検索。
 * 「価格に言及した人は誰か」をセッションを1件ずつ開かずに探せるようにする。
 */
export default function TranscriptSearch({ interviewId }: { interviewId: string }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ totalHits: number; sessionCount: number; truncated?: boolean; results: SearchResult[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState('')

  async function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) {
      setError('2文字以上で検索してください')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/interviews/${interviewId}/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
      setSearched(q)
    } catch {
      setError('検索に失敗しました')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setQuery(''); setData(null); setError(null); setSearched('')
  }

  // 一致部分を強調
  function highlight(text: string) {
    const q = searched.toLowerCase()
    if (!q) return text
    const parts: React.ReactNode[] = []
    const lower = text.toLowerCase()
    let from = 0
    for (;;) {
      const at = lower.indexOf(q, from)
      if (at === -1) { parts.push(text.slice(from)); break }
      if (at > from) parts.push(text.slice(from, at))
      parts.push(<mark key={at} className="bg-yellow-200 text-gray-900 rounded-sm px-0.5">{text.slice(at, at + q.length)}</mark>)
      from = at + q.length
    }
    return parts
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">発言を横断検索</h2>

      <form onSubmit={runSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="全参加者の発言から検索（例: 価格、迷った、わかりにくい）"
            aria-label="全参加者の発言を検索"
            className="w-full bg-white border border-gray-300 focus:border-gray-900 rounded-md pl-8 pr-8 py-2 text-sm placeholder-gray-400 focus:outline-none transition-colors"
          />
          {query && (
            <button type="button" onClick={clear} aria-label="クリア" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
          検索
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {data && (
        <div className="mt-4">
          <p className="text-xs text-gray-600 mb-3">
            {data.totalHits === 0
              ? <>「{searched}」に一致する発言はありませんでした</>
              : <><span className="font-semibold text-gray-900">{data.sessionCount}人{data.truncated && '以上'}</span> が言及・
                  <span className="font-semibold text-gray-900">{data.totalHits}件</span> の発言が一致</>}
          </p>
          {data.truncated && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
              一致が多いため一部のみ表示しています。検索語を絞ると全体を確認できます。
            </p>
          )}

          <div className="space-y-3">
            {data.results.map((r) => (
              <div key={r.sessionId} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-900">{r.participantName}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{r.hits.length}件</span>
                    <Link href={`/dashboard/sessions/${r.sessionId}`} className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2">
                      セッションを開く
                    </Link>
                  </div>
                </div>
                <ul className="divide-y divide-gray-100">
                  {r.hits.slice(0, 5).map((h) => (
                    <li key={h.id} className="px-3 py-2 flex gap-3">
                      <span className="text-[11px] text-gray-400 flex-shrink-0 w-20 pt-0.5">
                        {formatTime(h.startTime)}・{speakerLabel(h.speaker)}
                      </span>
                      <span className="text-sm text-gray-700 leading-snug">{highlight(h.text)}</span>
                    </li>
                  ))}
                  {r.hits.length > 5 && (
                    <li className="px-3 py-1.5 text-[11px] text-gray-500">ほか {r.hits.length - 5} 件</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
