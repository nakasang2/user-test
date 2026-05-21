'use client'

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
      <div className="p-8 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
        <p className="mb-2">文字起こしがありません。</p>
        <p className="text-sm">インタビューを実施するか、「AI 分析を実行」ボタンを押してください。</p>
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
    if (s === 'positive') return 'text-green-400'
    if (s === 'negative') return 'text-red-400'
    return 'text-gray-400'
  }

  return (
    <div className="space-y-4">
      {(transcript.summary || transcript.themes) && (
        <div className="grid grid-cols-2 gap-4">
          {transcript.summary && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">AI サマリー</div>
              <p className="text-sm text-gray-300 leading-relaxed">{transcript.summary}</p>
            </div>
          )}
          {transcript.themes && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">主要テーマ</div>
              <div className="flex flex-wrap gap-2">
                {transcript.themes.split(',').map((t, i) => (
                  <span key={i} className="bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded-full text-xs">
                    {t.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300">会話ログ</h3>
          <span className="text-xs text-gray-500">{transcript.segments.length} セグメント</span>
        </div>
        <div className="divide-y divide-gray-800/50">
          {transcript.segments.length === 0 ? (
            <div className="p-4">
              <pre className="text-sm text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">
                {transcript.fullText}
              </pre>
            </div>
          ) : (
            transcript.segments.map((seg) => (
              <div
                key={seg.id}
                className={`p-4 flex gap-4 ${seg.speaker === 'Interviewer' ? 'bg-gray-900' : 'bg-gray-950'}`}
              >
                <div className="flex-shrink-0 w-28">
                  <div className={`text-xs font-medium mb-1 ${
                    seg.speaker === 'Interviewer' ? 'text-indigo-400' : 'text-green-400'
                  }`}>
                    {seg.speaker === 'Interviewer' ? 'AI インタビュアー' : '参加者'}
                  </div>
                  <div className="text-xs text-gray-600">{formatTime(seg.startTime)}</div>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-200 leading-relaxed">{seg.text}</p>
                  {seg.sentiment && (
                    <span className={`text-xs mt-1 inline-block ${sentimentColor(seg.sentiment)}`}>
                      {seg.sentiment}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">質問一覧</div>
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="flex gap-3 text-sm">
              <span className="text-gray-600 flex-shrink-0">{q.order}.</span>
              <span className="text-gray-300">{q.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
