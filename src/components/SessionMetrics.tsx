'use client'

import { CheckCircle2, XCircle, MinusCircle, Clock, Star } from 'lucide-react'

export interface TaskResultData {
  taskId?: string | null
  order: number
  text: string
  /** completed | gave_up | not_attempted（未実施＝前提を満たせず着手できなかった） */
  outcome: string
  durationSec?: number | null
  seq?: number | null
  /** 集計対象外にした日時。null なら集計に含める */
  excludedAt?: string | null
  /** ヒントを見た上での結果か。自力の達成と混ぜると成功率が実態より良く見える */
  usedHint?: boolean | null
  /** 前提タスクの立て直し案内を受けて開始したか。自力で到達した人と分けて見る */
  assistedStart?: boolean | null
}

export interface AnswerData {
  questionId?: string | null
  order: number
  text: string
  type: string             // open | rating | nps
  valueNum?: number | null
  valueText?: string | null
  /** AI が追加で掘り下げた回数（自由回答のみ） */
  followUpCount?: number | null
  /** 自由回答に対する AI の肯定/否定判定 */
  sentiment?: string | null
  /** 集計対象外にした日時。null なら集計に含める */
  excludedAt?: string | null
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
  taskResults: allTaskResults,
  answers: allAnswers,
}: {
  taskResults: TaskResultData[]
  answers: AnswerData[]
}) {
  // 集計対象外にした行（削除したタスクの結果など）は除く。
  // ここを絞らないと、同じ数字が調査全体のページと食い違う。
  const taskResults = allTaskResults.filter((t) => t.excludedAt == null)
  const answers = allAnswers.filter((a) => a.excludedAt == null)

  const scored = answers.filter((a) => (a.type === 'rating' || a.type === 'nps') && typeof a.valueNum === 'number')
  if (taskResults.length === 0 && scored.length === 0) return null

  // 未実施（前のタスクの前提を満たせず着手できなかった分）は成功率の分母に入れない。
  // 「やってみて出来なかった」と同じ扱いにすると、タスクの難しさではなく
  // 前提の欠落を難しさとして数えてしまう。件数は別に出す。
  const notAttempted = taskResults.filter((t) => t.outcome === 'not_attempted')
  const attempted = taskResults.filter((t) => t.outcome !== 'not_attempted')
  const completed = attempted.filter((t) => t.outcome === 'completed').length
  const successRate = attempted.length ? Math.round((completed / attempted.length) * 100) : null
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
              <p className="text-2xl font-semibold text-gray-900 leading-none">
                {successRate !== null
                  ? <>{successRate}<span className="text-sm font-normal text-gray-500 ml-0.5">%</span></>
                  : <span className="text-sm font-normal text-gray-400">—</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                {completed} / {attempted.length} 件
                {notAttempted.length > 0 && (
                  <span className="text-gray-400" title="前のタスクの前提を満たせず、着手する機会が無かった分。成功率には含めていません">
                    ・未実施 {notAttempted.length}
                  </span>
                )}
              </p>
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
              const skipped = t.outcome === 'not_attempted'
              return (
                <li key={t.order} className="flex items-start gap-2.5 px-3 py-2.5 bg-white">
                  {skipped
                    ? <MinusCircle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
                    : ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
                    : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500">タスク {t.order}</p>
                    <p className={`text-sm leading-snug break-words ${skipped ? 'text-gray-500' : 'text-gray-900'}`}>{t.text}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-xs font-medium ${skipped ? 'text-gray-500' : ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {skipped ? '未実施' : ok ? '達成' : 'できなかった'}
                    </p>
                    {skipped && (
                      <p className="text-[11px] text-gray-400 mt-0.5" title="成功率の分母には含めていません">
                        前提を満たせず
                      </p>
                    )}
                    {t.usedHint === true && (
                      <p className="text-[11px] text-amber-700 mt-0.5" title="ヒントを見た上での結果">
                        ヒントあり
                      </p>
                    )}
                    {t.assistedStart === true && (
                      <p className="text-[11px] text-amber-700 mt-0.5" title="前のタスクを断念したため、開始地点まで案内した上で実施">
                        前提を代行
                      </p>
                    )}
                    {typeof t.durationSec === 'number' && t.durationSec > 0 && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 justify-end mt-0.5">
                        <Clock className="w-3 h-3" strokeWidth={2} />
                        {formatDuration(t.durationSec)}
                      </p>
                    )}
                    {typeof t.seq === 'number' && (
                      <p className="text-[11px] text-gray-500 mt-0.5" title="SEQ: 操作の簡単さ（1=とても難しい 〜 7=とても簡単）">
                        SEQ {t.seq}<span className="text-gray-400"> / 7</span>
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
