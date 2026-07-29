'use client'

import { useState } from 'react'
import { EyeOff, Undo2 } from 'lucide-react'
import { formatDuration } from './SessionMetrics'
import {
  aggregateTasks,
  aggregateScores,
  overallSuccess,
  calcNps,
  type SessionLike,
} from '@/lib/interview-aggregate'

/**
 * 集計キー（taskId / questionId、無ければ `text:文言`）を API に渡す形へ戻す。
 * 文言キーの行は元の項目が既に削除されているので、id では特定できない。
 */
function targetOf(key: string, text: string): { id: string | null; text: string | null } {
  return key.startsWith('text:') ? { id: null, text } : { id: key, text: null }
}

/**
 * インタビュー横断の定量集計（タスクごとの内訳）。
 * 「タスクごとに何人が成功したか」がユーザビリティテストの一次アウトプットなので、
 * 参加者単位ではなくタスク単位に集約して見せる。
 *
 * 全体の成功率など見出しの数字は InterviewSummary が上部に出す。
 * 食い違わないよう、算出はどちらも src/lib/interview-aggregate.ts を使う。
 */
export default function InterviewMetrics({
  sessions,
  interviewId,
  onChanged,
}: {
  sessions: SessionLike[]
  interviewId: string
  /** 集計対象の変更後に呼ぶ。親がデータを取り直す */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function setExcluded(kind: 'task' | 'answer', key: string, text: string, excluded: boolean) {
    setBusy(key)
    try {
      const res = await fetch(`/api/interviews/${interviewId}/exclude-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...targetOf(key, text), excluded }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.error ?? '変更に失敗しました')
        return
      }
      onChanged()
    } catch {
      alert('変更に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  // 「N人」は成功率の分子分母に寄与している人数。除外済みの行しか無いセッションは数えない
  // （aggregateTasks が除外済みを落とすので、ここだけ全件で数えると分母と食い違う）
  const withResults = sessions.filter((s) => (s.taskResults ?? []).some((t) => t.excludedAt == null))
  const taskRows = aggregateTasks(sessions)
  const scoreRows = aggregateScores(sessions)
  const excludedTasks = aggregateTasks(sessions, { excluded: true })
  const excludedScores = aggregateScores(sessions, { excluded: true })

  if (taskRows.length === 0 && scoreRows.length === 0 && excludedTasks.length === 0 && excludedScores.length === 0) {
    return null
  }

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
                {/* ヒントを使った人がいるときだけ「自力では何%か」を併記する */}
                {overall.hintUsed > 0 && (
                  <span className="ml-2 text-gray-500" title="ヒントを見ずに達成できた割合（自力成功率）">
                    自力 {overall.unaidedRate}%
                    {/* 人数も出す。ヒントを見た人が全員失敗すると成功率と自力成功率が
                        同じ数字になり、なぜ併記されているのか読み取れなくなるため */}
                    <span className="text-gray-400">（ヒント {overall.hintUsed}回）</span>
                  </span>
                )}
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
                    <p className="text-xs text-gray-600 flex-shrink-0 tabular-nums flex items-baseline gap-2">
                      <span>
                        <span className="font-semibold text-gray-900">{rate}%</span>
                        <span className="text-gray-400"> ({t.completed}/{t.total})</span>
                        {t.hintUsed > 0 && (
                          <span
                            className="ml-2 text-amber-700"
                            title="ヒントを見た人数（達成できなかった人も含む）。うち達成した人数は括弧内"
                          >
                            ヒント {t.hintUsed}人
                            <span className="text-gray-400">（達成 {t.completed - t.completedUnaided}）</span>
                          </span>
                        )}
                        {avgDur !== null && <span className="ml-2 text-gray-500">平均 {formatDuration(avgDur)}</span>}
                        {t.seqs.length > 0 && (
                          <span className="ml-2 text-gray-500" title="SEQ: 操作の簡単さの平均（7が最も簡単）">
                            SEQ {(t.seqs.reduce((a, b) => a + b, 0) / t.seqs.length).toFixed(1)}
                          </span>
                        )}
                      </span>
                      <ExcludeButton
                        busy={busy === t.key}
                        onClick={() => setExcluded('task', t.key, t.text, true)}
                      />
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
                  <div className="flex-shrink-0 flex items-baseline gap-2">
                    <div className="text-right tabular-nums">
                      <p className="text-sm font-semibold text-gray-900">
                        {isNps ? `NPS ${calcNps(s.values)}` : `平均 ${mean.toFixed(1)}`}
                        <span className="text-xs font-normal text-gray-500 ml-1">
                          {isNps ? `（平均 ${mean.toFixed(1)} / 10）` : '/ 5'}
                        </span>
                      </p>
                      <p className="text-[11px] text-gray-500">n = {s.values.length}</p>
                    </div>
                    <ExcludeButton
                      busy={busy === s.key}
                      onClick={() => setExcluded('answer', s.key, s.text, true)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(excludedTasks.length > 0 || excludedScores.length > 0) && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">集計から外した項目</h2>
          <p className="text-[11px] text-gray-500 mb-4">
            調査から削除したタスク・質問の結果と、手動で外した分です。記録は残していますが、全体指標には含めていません。
            外したのは「外した時点までの結果」なので、その後に実施された分は上の一覧に出ます。
          </p>
          <div className="space-y-2">
            {excludedTasks.map((t) => (
              <ExcludedRow
                key={t.key}
                text={t.text}
                detail={`${Math.round((t.completed / t.total) * 100)}%（${t.completed}/${t.total}）`}
                busy={busy === t.key}
                onRestore={() => setExcluded('task', t.key, t.text, false)}
              />
            ))}
            {excludedScores.map((s) => (
              <ExcludedRow
                key={s.key}
                text={s.text}
                detail={
                  s.type === 'nps'
                    ? `NPS ${calcNps(s.values)}・n=${s.values.length}`
                    : `平均 ${(s.values.reduce((a, b) => a + b, 0) / s.values.length).toFixed(1)}・n=${s.values.length}`
                }
                busy={busy === s.key}
                onRestore={() => setExcluded('answer', s.key, s.text, false)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 控えめに置くが、常に見える濃さにする。
 * hover でしか現れない作りにすると、タッチ端末では hover が発火せず操作できなくなる。
 * 当たり判定はパディングで 24px 以上を確保する（アイコン自体は 14px）。
 */
function ExcludeButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="この項目を全体指標の集計から外す（記録は残ります。あとで戻せます）"
      className="flex-shrink-0 -m-1.5 p-1.5 text-gray-400 hover:text-gray-900 focus-visible:text-gray-900 disabled:opacity-40 transition-colors"
      aria-label="集計から外す"
    >
      <EyeOff className="w-3.5 h-3.5" strokeWidth={2} />
    </button>
  )
}

function ExcludedRow({
  text,
  detail,
  busy,
  onRestore,
}: {
  text: string
  detail: string
  busy: boolean
  onRestore: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
      <p className="text-sm text-gray-600 leading-snug min-w-0 truncate">{text}</p>
      <div className="flex-shrink-0 flex items-center gap-3">
        <span className="text-xs text-gray-500 tabular-nums">{detail}</span>
        <button
          onClick={onRestore}
          disabled={busy}
          className="inline-flex items-center gap-1 border border-gray-300 hover:border-gray-900 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-2 py-1 rounded-md text-xs transition-colors"
        >
          <Undo2 className="w-3 h-3" strokeWidth={2} />
          {busy ? '…' : '集計に戻す'}
        </button>
      </div>
    </div>
  )
}
