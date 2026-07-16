'use client'

import { FileText } from 'lucide-react'

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
}

export default function TranscriptView({ transcript, questions }: Props) {
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

  const sentimentColor = (s: string | null) => {
    if (!s) return 'text-gray-500'
    if (s === 'positive') return 'text-emerald-700'
    if (s === 'negative') return 'text-red-700'
    return 'text-gray-500'
  }

  const speakerLabel = (speaker: string) => {
    if (speaker === 'Interviewer') return 'AI インタビュアー'
    if (speaker === 'Participant') return '参加者'
    if (speaker === 'System') return 'タスク記録'
    if (speaker === 'Unknown') return '話者不明'
    return speaker
  }

  const sentimentLabel = (s: string | null) => {
    if (s === 'positive') return 'ポジティブ'
    if (s === 'negative') return 'ネガティブ'
    if (s === 'neutral') return 'ニュートラル'
    return s
  }

  return (
    <div className="space-y-4">
      {(transcript.summary || transcript.themes) && (
        <div className="grid grid-cols-2 gap-4">
          {transcript.summary && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">AI サマリー</div>
              <p className="text-sm text-gray-700 leading-relaxed">{transcript.summary}</p>
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
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-gray-900">会話ログ</h3>
          <span className="text-xs text-gray-500">{transcript.segments.length} セグメント</span>
        </div>
        <div className="divide-y divide-gray-200">
          {transcript.segments.length === 0 ? (
            <div className="p-4">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {transcript.fullText}
              </pre>
            </div>
          ) : (
            transcript.segments.map((seg) => (
              <div
                key={seg.id}
                className={`p-4 flex gap-4 ${seg.speaker === 'Interviewer' ? 'bg-white' : 'bg-gray-50'}`}
              >
                <div className="flex-shrink-0 w-28">
                  <div className={`text-xs font-medium mb-1 ${
                    seg.speaker === 'Interviewer' ? 'text-gray-900'
                      : seg.speaker === 'Participant' ? 'text-emerald-700' : 'text-gray-500'
                  }`}>
                    {speakerLabel(seg.speaker)}
                  </div>
                  <div className="text-xs text-gray-500">{formatTime(seg.startTime)}</div>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-700 leading-relaxed">{seg.text}</p>
                  {seg.sentiment && (
                    <span className={`text-xs mt-1 inline-block ${sentimentColor(seg.sentiment)}`}>
                      {sentimentLabel(seg.sentiment)}
                    </span>
                  )}
                </div>
              </div>
            ))
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
