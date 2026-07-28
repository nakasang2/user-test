'use client'

import { CheckCircle2, XCircle, Clock, Star } from 'lucide-react'

export interface TaskResultData {
  order: number
  text: string
  outcome: string          // completed | gave_up
  durationSec?: number | null
}

export interface AnswerData {
  order: number
  text: string
  type: string             // open | rating | nps
  valueNum?: number | null
  valueText?: string | null
}

/** 秒を「1分23秒」形式に */
export function formatDuration(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return `${s}秒`
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}

/**
 * セッション単位の定量結果（タスク成功率・所要時間・評価スコア）。
 * 文字起こしと違い、ここは構造化データなので数値として集計できる。
 */
export default function SessionMetrics({
  taskResults,
  answers,
}: {
  taskResults: TaskResultData[]
  answers: AnswerData[]
}) {
  const scored = answers.filter((a) => (a.type === 'rating' || a.type === 'nps') && typeof a.valueNum === 'number')
  if (taskResults.length === 0 && scored.length === 0) return null

  const completed = taskResults.filter((t) => t.outcome === 'completed').length
  const successRate = taskResults.length ? Math.round((completed / taskResults.length) * 100) : null
  const durations = taskResults.map((t) => t.durationSec).filter((d): d is number => typeof d === 'number' && d > 0)
  const totalDuration = durations.reduce((a, b) => a + b, 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      <h2 className="text-sm font-semibold text-gray-900">測定結果</h2>

      {taskResults.length > 0 && (
        <div className="space-y-3">
          {/* サマリー指標 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-1">タスク成功率</p>
              <p className="text-2xl font-semibold text-gray-900 leading-none">{successRate}<span className="text-sm font-normal text-gray-500 ml-0.5">%</span></p>
              <p className="text-[11px] text-gray-500 mt-1">{completed} / {taskResults.length} 件</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-1">合計所要時間</p>
              <p className="text-2xl font-semibold text-gray-900 leading-none">
                {durations.length ? formatDuration(totalDuration) : <span className="text-sm font-normal text-gray-400">—</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">計測 {durations.length} 件</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-1">平均所要時間</p>
              <p className="text-2xl font-semibold text-gray-900 leading-none">
                {durations.length ? formatDuration(totalDuration / durations.length) : <span className="text-sm font-normal text-gray-400">—</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">1タスクあたり</p>
            </div>
          </div>

          {/* タスク別の内訳 */}
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {taskResults.map((t) => {
              const ok = t.outcome === 'completed'
              return (
                <li key={t.order} className="flex items-start gap-2.5 px-3 py-2.5 bg-white">
                  {ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
                    : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500">タスク {t.order}</p>
                    <p className="text-sm text-gray-900 leading-snug break-words">{t.text}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-xs font-medium ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {ok ? '達成' : 'できなかった'}
                    </p>
                    {typeof t.durationSec === 'number' && t.durationSec > 0 && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 justify-end mt-0.5">
                        <Clock className="w-3 h-3" strokeWidth={2} />
                        {formatDuration(t.durationSec)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* 評価スコア */}
      {scored.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
            評価スコア
          </p>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {scored.map((a) => (
              <li key={`${a.order}-${a.type}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm text-gray-800 leading-snug break-words min-w-0">{a.text}</span>
                <span className="flex-shrink-0 text-sm font-semibold text-gray-900">
                  {a.valueNum}
                  <span className="text-xs font-normal text-gray-500"> / {a.type === 'nps' ? 10 : 5}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
