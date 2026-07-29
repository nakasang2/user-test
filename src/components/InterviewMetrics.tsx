'use client'

import { formatDuration } from './SessionMetrics'
import {
  aggregateTasks,
  aggregateScores,
  overallSuccess,
  calcNps,
  type SessionLike,
} from '@/lib/interview-aggregate'

/**
 * インタビュー横断の定量集計（タスクごとの内訳）。
 * 「タスクごとに何人が成功したか」がユーザビリティテストの一次アウトプットなので、
 * 参加者単位ではなくタスク単位に集約して見せる。
 *
 * 全体の成功率など見出しの数字は InterviewSummary が上部に出す。
 * 食い違わないよう、算出はどちらも src/lib/interview-aggregate.ts を使う。
 */
export default function InterviewMetrics({ sessions }: { sessions: SessionLike[] }) {
  const withResults = sessions.filter((s) => (s.taskResults?.length ?? 0) > 0)
  const taskRows = aggregateTasks(sessions)
  const scoreRows = aggregateScores(sessions)

  if (taskRows.length === 0 && scoreRows.length === 0) return null

  const overall = overallSuccess(taskRows)

  return (
    <div className="space-y-6">
      {taskRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">タスク成功率</h2>
            {/* overall が null になるのは taskRows が空のときだけで、その場合この枠自体を描画しない。
                それでも 0 除算で NaN を出さないよう分岐しておく */}
            {overall && (
              <p className="text-xs text-gray-500">
                全体 <span className="text-base font-semibold text-gray-900">{overall.rate}%</span>
                <span className="ml-1">（{overall.completed} / {overall.total}）・{withResults.length}人</span>
              </p>
            )}
          </div>
          <div className="space-y-3">
            {taskRows.map((t) => {
              const rate = Math.round((t.completed / t.total) * 100)
              const avgDur = t.durations.length
                ? t.durations.reduce((a, b) => a + b, 0) / t.durations.length
                : null
              // 一般に成功率 70% 未満は要改善のシグナルとして扱われる
              const tone = rate >= 90 ? 'bg-emerald-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div key={t.key}>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <p className="text-sm text-gray-900 leading-snug min-w-0">
                      <span className="text-gray-400 mr-1.5">{t.order}.</span>{t.text}
                    </p>
                    <p className="text-xs text-gray-600 flex-shrink-0 tabular-nums">
                      <span className="font-semibold text-gray-900">{rate}%</span>
                      <span className="text-gray-400"> ({t.completed}/{t.total})</span>
                      {avgDur !== null && <span className="ml-2 text-gray-500">平均 {formatDuration(avgDur)}</span>}
                      {t.seqs.length > 0 && (
                        <span className="ml-2 text-gray-500" title="SEQ: 操作の簡単さの平均（7が最も簡単）">
                          SEQ {(t.seqs.reduce((a, b) => a + b, 0) / t.seqs.length).toFixed(1)}
                        </span>
                      )}
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
            {scoreRows.map((s) => {
              const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length
              const isNps = s.type === 'nps'
              return (
                <div key={s.key} className="flex items-baseline justify-between gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <p className="text-sm text-gray-900 leading-snug min-w-0">
                    <span className="text-gray-400 mr-1.5">{s.order}.</span>{s.text}
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
