'use client'

import { formatDuration, type TaskResultData, type AnswerData } from './SessionMetrics'

interface SessionLike {
  id: string
  participantName: string
  taskResults?: TaskResultData[]
  answers?: AnswerData[]
}

/** NPS = 推奨者(9-10)% − 批判者(0-6)% */
function calcNps(values: number[]): number {
  const promoters = values.filter((v) => v >= 9).length
  const detractors = values.filter((v) => v <= 6).length
  return Math.round(((promoters - detractors) / values.length) * 100)
}

/**
 * インタビュー横断の定量集計。
 * 「タスクごとに何人が成功したか」がユーザビリティテストの一次アウトプットなので、
 * 参加者単位ではなくタスク単位に集約して見せる。
 */
export default function InterviewMetrics({ sessions }: { sessions: SessionLike[] }) {
  const withResults = sessions.filter((s) => (s.taskResults?.length ?? 0) > 0)
  const allAnswers = sessions.flatMap((s) => s.answers ?? [])

  // タスク単位に集約（order をキーに、文言は最初に出たものを採用）
  const taskMap = new Map<number, { text: string; completed: number; total: number; durations: number[] }>()
  withResults.forEach((s) => {
    s.taskResults?.forEach((t) => {
      const cur = taskMap.get(t.order) ?? { text: t.text, completed: 0, total: 0, durations: [] }
      cur.total += 1
      if (t.outcome === 'completed') cur.completed += 1
      if (typeof t.durationSec === 'number' && t.durationSec > 0) cur.durations.push(t.durationSec)
      taskMap.set(t.order, cur)
    })
  })
  const taskRows = [...taskMap.entries()].sort(([a], [b]) => a - b)

  // スコア質問を order でグループ化
  const scoreMap = new Map<number, { text: string; type: string; values: number[] }>()
  allAnswers.forEach((a) => {
    if ((a.type !== 'rating' && a.type !== 'nps') || typeof a.valueNum !== 'number') return
    const cur = scoreMap.get(a.order) ?? { text: a.text, type: a.type, values: [] }
    cur.values.push(a.valueNum)
    scoreMap.set(a.order, cur)
  })
  const scoreRows = [...scoreMap.entries()].sort(([a], [b]) => a - b)

  if (taskRows.length === 0 && scoreRows.length === 0) return null

  const overallTotal = taskRows.reduce((sum, [, t]) => sum + t.total, 0)
  const overallDone = taskRows.reduce((sum, [, t]) => sum + t.completed, 0)

  return (
    <div className="space-y-6">
      {taskRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">タスク成功率</h2>
            <p className="text-xs text-gray-500">
              全体 <span className="text-base font-semibold text-gray-900">{Math.round((overallDone / overallTotal) * 100)}%</span>
              <span className="ml-1">（{overallDone} / {overallTotal}）・{withResults.length}人</span>
            </p>
          </div>
          <div className="space-y-3">
            {taskRows.map(([order, t]) => {
              const rate = Math.round((t.completed / t.total) * 100)
              const avgDur = t.durations.length
                ? t.durations.reduce((a, b) => a + b, 0) / t.durations.length
                : null
              // 一般に成功率 70% 未満は要改善のシグナルとして扱われる
              const tone = rate >= 90 ? 'bg-emerald-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div key={order}>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <p className="text-sm text-gray-900 leading-snug min-w-0">
                      <span className="text-gray-400 mr-1.5">{order}.</span>{t.text}
                    </p>
                    <p className="text-xs text-gray-600 flex-shrink-0 tabular-nums">
                      <span className="font-semibold text-gray-900">{rate}%</span>
                      <span className="text-gray-400"> ({t.completed}/{t.total})</span>
                      {avgDur !== null && <span className="ml-2 text-gray-500">平均 {formatDuration(avgDur)}</span>}
                    </p>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${tone} rounded-full transition-all`} style={{ width: `${rate}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {scoreRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">評価スコア</h2>
          <div className="space-y-3">
            {scoreRows.map(([order, s]) => {
              const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length
              const isNps = s.type === 'nps'
              return (
                <div key={order} className="flex items-baseline justify-between gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <p className="text-sm text-gray-900 leading-snug min-w-0">
                    <span className="text-gray-400 mr-1.5">{order}.</span>{s.text}
                  </p>
                  <div className="flex-shrink-0 text-right tabular-nums">
                    <p className="text-sm font-semibold text-gray-900">
                      {isNps ? `NPS ${calcNps(s.values)}` : `平均 ${mean.toFixed(1)}`}
                      <span className="text-xs font-normal text-gray-500 ml-1">
                        {isNps ? `（平均 ${mean.toFixed(1)} / 10）` : '/ 5'}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-500">n = {s.values.length}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
