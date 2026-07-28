'use client'

import { useState, useEffect, useRef } from 'react'
import { FileText, Search, X, Highlighter } from 'lucide-react'
import { normalizeSentiment } from '@/lib/sentiment'

interface Segment {
  id: string
  speaker: string
  text: string
  startTime: number
  endTime: number
  sentiment: string | null
}

interface Transcript {
  fullText: string
  summary: string | null
  themes: string | null
  sentiment?: string | null       // インタビュー全体のトーン
  sentimentNote?: string | null   // その根拠の短い説明
  segments: Segment[]
}

interface Question {
  id: string
  text: string
  order: number
}

interface Props {
  transcript: Transcript | null
  questions: Question[]
  /** 発言をハイライトに追加する。未指定なら「引用」ボタンを出さない（共有ページなど） */
  onHighlight?: (seg: { id: string; text: string; startTime: number }) => void
  /** 既にハイライト済みの発言 id（ボタンの状態表示に使う） */
  highlightedSegmentIds?: Set<string>
  /** 発言をクリックしたときに動画をその時刻へ送る。未指定なら行はクリック不可 */
  onSeek?: (seconds: number) => void
  /** 動画の再生位置（秒）。該当する発言をハイライトする */
  currentTime?: number
}

export default function TranscriptView({
  transcript, questions, onHighlight, highlightedSegmentIds, onSeek, currentTime,
}: Props) {
  // 検索語（フック規則のため早期 return より前に宣言する）
  const [query, setQuery] = useState('')
  // 再生に合わせて会話ログを自動スクロールするか（追いかけられると読みにくい場合があるので切れる）
  const [follow, setFollow] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // 再生位置が変わったら、該当の発言を会話ログの中だけスクロールして見せる
  useEffect(() => {
    if (!follow) return
    const el = activeRef.current
    const box = logRef.current
    if (!el || !box) return
    const elTop = el.offsetTop - box.offsetTop
    const target = elTop - box.clientHeight / 2 + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [currentTime, follow])

  if (!transcript) {
    return (
      <div className="p-8 text-center bg-white border border-gray-200 rounded-lg">
        <FileText className="w-5 h-5 text-gray-400 mx-auto mb-3" strokeWidth={1.75} />
        <p className="mb-2 text-sm text-gray-700">文字起こしがありません。</p>
        <p className="text-sm text-gray-500">インタビューを実施するか、「AI 分析を実行」ボタンを押してください。</p>
      </div>
    )
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // 過去データには "positive - the participant..." のような説明付きの値が入っているため、
  // 完全一致ではなく正規化してから判定する（表示が英語の生文字列になるのを防ぐ）。
  const normalize = normalizeSentiment

  const sentimentChip = (s: string | null) => {
    const v = normalize(s)
    if (v === 'positive') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (v === 'negative') return 'bg-red-50 text-red-700 border-red-200'
    return 'bg-gray-100 text-gray-600 border-gray-200'
  }

  // 検索: 一致した発言だけに絞り込み、一致部分を黄色でハイライトする
  const q = query.trim().toLowerCase()
  const matchedSegments = q
    ? transcript.segments.filter((s) => s.text.toLowerCase().includes(q))
    : transcript.segments

  const highlight = (text: string) => {
    if (!q) return text
    const parts: React.ReactNode[] = []
    const lower = text.toLowerCase()
    let from = 0
    for (;;) {
      const at = lower.indexOf(q, from)
      if (at === -1) { parts.push(text.slice(from)); break }
      if (at > from) parts.push(text.slice(from, at))
      parts.push(
        <mark key={`${at}`} className="bg-yellow-200 text-gray-900 rounded-sm px-0.5">
          {text.slice(at, at + q.length)}
        </mark>
      )
      from = at + q.length
    }
    return parts
  }

  // 再生位置に対応する発言。区間に入るものを優先し、無ければ直前の発言を選ぶ。
  const activeSegmentId = (() => {
    if (currentTime === undefined || transcript.segments.length === 0) return null
    const inRange = transcript.segments.find(
      (sg) => currentTime >= sg.startTime && currentTime < Math.max(sg.endTime, sg.startTime + 0.5)
    )
    if (inRange) return inRange.id
    const passed = transcript.segments.filter((sg) => sg.startTime <= currentTime)
    return passed.length > 0 ? passed[passed.length - 1].id : null
  })()

  const speakerLabel = (speaker: string) => {
    if (speaker === 'Interviewer') return 'AI インタビュアー'
    if (speaker === 'Participant') return '参加者'
    if (speaker === 'System') return 'タスク記録'
    if (speaker === 'Unknown') return '話者不明'
    return speaker
  }

  const sentimentLabel = (s: string | null | undefined) => {
    const v = normalize(s)
    if (v === 'positive') return 'ポジティブ'
    if (v === 'negative') return 'ネガティブ'
    if (v === 'neutral') return 'ニュートラル'
    return null   // 判定できない値は表示しない（英語の生文字列を出さない）
  }

  return (
    <div className="space-y-4">
      {(transcript.summary || transcript.themes) && (
        <div className="grid grid-cols-2 gap-4">
          {transcript.summary && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">AI サマリー</div>
              <p className="text-sm text-gray-700 leading-relaxed">{transcript.summary}</p>
              {sentimentLabel(transcript.sentiment) && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-2">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0 ${sentimentChip(transcript.sentiment ?? null)}`}>
                    全体: {sentimentLabel(transcript.sentiment)}
                  </span>
                  {transcript.sentimentNote && (
                    <span className="text-xs text-gray-500 leading-snug">{transcript.sentimentNote}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {transcript.themes && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">主要テーマ</div>
              <div className="flex flex-wrap gap-2">
                {transcript.themes.split(',').map((t, i) => (
                  <span key={i} className="bg-gray-100 text-gray-700 border border-gray-200 px-2 py-1 rounded-md text-xs">
                    {t.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight text-gray-900">会話ログ</h3>
            <div className="flex items-center gap-3">
              {onSeek && (
                <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer" title="再生中の発言まで会話ログを自動でスクロールします">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                  再生に追従
                </label>
              )}
              <span className="text-xs text-gray-500">
                {q
                  ? <><span className="font-medium text-gray-900">{matchedSegments.length}</span> 件が一致 / 全 {transcript.segments.length}</>
                  : <>{transcript.segments.length} セグメント</>}
              </span>
            </div>
          </div>
          {/* 発言内の全文検索。セグメント未分割（全文のみ）のときは絞り込めないので出さない */}
          {transcript.segments.length > 0 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={2} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="発言を検索（例: 価格、わかりにくい）"
              aria-label="会話ログを検索"
              className="w-full pl-8 pr-8 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-gray-500 placeholder:text-gray-500"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="検索をクリア"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          )}
        </div>
        <div ref={logRef} className="divide-y divide-gray-200 max-h-[32rem] overflow-y-auto">
          {transcript.segments.length === 0 ? (
            <div className="p-4">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {transcript.fullText}
              </pre>
            </div>
          ) : matchedSegments.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-700 mb-1">「{query}」に一致する発言はありません</p>
              <button onClick={() => setQuery('')} className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2">
                検索をクリア
              </button>
            </div>
          ) : (
            matchedSegments.map((seg) => {
              const isActive = seg.id === activeSegmentId
              return (
              <div
                key={seg.id}
                ref={isActive ? activeRef : undefined}
                // 発言クリックで動画をその時刻へ。再生中の発言は左に帯を出して分かるようにする
                onClick={onSeek ? () => onSeek(seg.startTime) : undefined}
                className={`p-4 flex gap-4 transition-colors ${
                  isActive
                    ? 'bg-blue-50 border-l-2 border-blue-500'
                    : seg.speaker === 'Interviewer' ? 'bg-white' : 'bg-gray-50'
                } ${onSeek ? 'cursor-pointer hover:bg-blue-50/60' : ''}`}
              >
                <div className="flex-shrink-0 w-28">
                  <div className={`text-xs font-medium mb-1 ${
                    seg.speaker === 'Interviewer' ? 'text-gray-900'
                      : seg.speaker === 'Participant' ? 'text-emerald-700' : 'text-gray-500'
                  }`}>
                    {speakerLabel(seg.speaker)}
                  </div>
                  <div className={`text-xs ${isActive ? 'text-blue-700 font-medium' : 'text-gray-500'}`}>
                    {formatTime(seg.startTime)}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-start gap-2">
                    <p className="text-sm text-gray-700 leading-relaxed flex-1">{highlight(seg.text)}</p>
                    {onHighlight && (
                      highlightedSegmentIds?.has(seg.id) ? (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded">
                          <Highlighter className="w-3 h-3" strokeWidth={2} />引用済み
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onHighlight({ id: seg.id, text: seg.text, startTime: seg.startTime }) }}
                          title="この発言をハイライトに追加"
                          className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors"
                        >
                          <Highlighter className="w-3 h-3" strokeWidth={2} />引用
                        </button>
                      )
                    )}
                  </div>
                  {sentimentLabel(seg.sentiment) && (
                    <span className={`text-[11px] mt-1.5 inline-block px-1.5 py-0.5 rounded border ${sentimentChip(seg.sentiment)}`}>
                      {sentimentLabel(seg.sentiment)}
                    </span>
                  )}
                </div>
              </div>
              )
            })
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">質問一覧</div>
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="flex gap-3 text-sm">
              <span className="text-gray-500 flex-shrink-0">{q.order}.</span>
              <span className="text-gray-700">{q.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
