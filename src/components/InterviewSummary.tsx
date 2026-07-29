'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles, Wand2 } from 'lucide-react'
import { formatDuration } from './SessionMetrics'
import {
  aggregateTasks,
  aggregateScores,
  overallSuccess,
  avgSessionDuration,
  headlineScore,
  hardestTask,
  type SessionLike,
} from '@/lib/interview-aggregate'

/**
 * 調査ページ最上部の「結果サマリー」。
 *
 * 参加者一覧が先頭にあると「この調査がどうだったのか」が分からないため、
 * 結論にあたる数字（成功率・スコア・所要時間）と、最も問題があったタスク、
 * AI の総括をページの一番上に置く。
 *
 * 数字は src/lib/interview-aggregate.ts に集約しており、下部の詳細
 * （InterviewMetrics）と同じ関数で算出しているので食い違わない。
 */
export default function InterviewSummary({
  sessions,
  commonInsights,
  onBackfill,
  backfilling,
}: {
  /** パイロットを除いた本番セッション */
  sessions: SessionLike[]
  commonInsights: string | null
  onBackfill: () => void
  backfilling: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  // 総括が3行に収まっているときは「続きを見る」を出さない（押しても何も起きないため）。
  // 収まるかは画面幅で変わるので、実際の描画結果を測るしかない。
  const insightRef = useRef<HTMLDivElement>(null)
  const [truncated, setTruncated] = useState(false)

  useLayoutEffect(() => {
    const el = insightRef.current
    // 展開中は clamp が外れて必ず scrollHeight === clientHeight になるため測らない。
    // ここで測ってしまうと truncated が false に戻り「閉じる」ボタンが消える。
    if (!el || expanded) return
    // 描画結果からしか判定できない値なので、レンダー中ではなくここで state に入れる
    const measure = () => setTruncated(el.scrollHeight > el.clientHeight + 1)
    measure()
    // 画面幅が変われば収まるかどうかも変わる
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [commonInsights, expanded])

  const tasks = aggregateTasks(sessions)
  const scores = aggregateScores(sessions)
  const success = overallSuccess(tasks)
  const score = headlineScore(scores)
  const avgDur = avgSessionDuration(sessions)
  const worst = hardestTask(tasks)

  // completed（被験者が完了）→ processing（AI分析中）→ done。
  // processing を外すと分析中の数分だけ「未完了」に見えてしまう。
  const finished = sessions.filter(
    (s) => s.status === 'done' || s.status === 'completed' || s.status === 'processing'
  ).length
  const hasMeasurements = success !== null || score !== null

  // 測定データも AI 総括も無い場合。黙って消すと「機能が無い」ように見えるので、
  // 理由と次の一手（文字起こしからの抽出）を出す。
  if (!hasMeasurements && !commonInsights) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">結果サマリー</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          {sessions.length === 0
            ? 'まだセッションがありません。招待リンクを参加者に送ると、ここに調査全体の結果が出ます。'
            : 'このテストにはまだ集計できる測定結果がありません。実施中に記録されたタスクの成否や評価スコアが集まると、ここに全体の成功率とスコアが出ます。'}
        </p>
        {sessions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">
              測定結果を保存する仕組みより前に実施したセッションは、文字起こしから回答を復元できます。
            </p>
            <button
              onClick={onBackfill}
              disabled={backfilling}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-900 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" strokeWidth={2} />
              {backfilling ? '抽出中…' : '文字起こしから回答を抽出する'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">結果サマリー</h2>

      {/* 見出し指標 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Tile
          label="タスク成功率"
          value={success ? `${success.rate}%` : null}
          sub={
            success
              ? success.hintUsed > 0
                // ヒントを使った人がいるときは「自力では何%か」を必ず併記する。
                // 併記しないと「助けがあれば出来る」を「出来る」と読み違える
                ? `${success.completed} / ${success.total} 回・自力 ${success.unaidedRate}%`
                : `${success.completed} / ${success.total} 回`
              : '測定データなし'
          }
        >
          {success && (
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
              <div
                className={`h-full rounded-full ${success.rate >= 90 ? 'bg-emerald-500' : success.rate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${success.rate}%` }}
              />
            </div>
          )}
        </Tile>

        <Tile
          label={score?.kind === 'nps' ? 'NPS' : '平均スコア'}
          value={
            score === null
              ? null
              : score.kind === 'nps'
                ? (score.value > 0 ? `+${score.value}` : String(score.value))
                : score.mean.toFixed(1)
          }
          sub={
            score === null
              ? 'スコア質問なし'
              : score.kind === 'nps'
                ? `平均 ${score.mean.toFixed(1)} / 10 · n=${score.n}`
                : `5点満点 · n=${score.n}`
          }
        />

        <Tile
          label="平均所要時間"
          value={avgDur !== null ? formatDuration(avgDur.mean) : null}
          sub={avgDur !== null ? `参加者1人あたり · n=${avgDur.n}` : '計測データなし'}
        />

        <Tile label="完了" value={`${finished}人`} sub={`全 ${sessions.length} 人中`} />
      </div>

      {/* 最も苦戦したタスク。全問 100% のときは出さない */}
      {worst && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2.5 mb-4 border ${
            worst.rate < 70 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
          }`}
        >
          <AlertTriangle
            className={`w-4 h-4 flex-shrink-0 mt-0.5 ${worst.rate < 70 ? 'text-red-600' : 'text-amber-600'}`}
            strokeWidth={2}
          />
          <p className="text-sm text-gray-900 leading-snug min-w-0">
            <span className="font-medium">最も苦戦したタスク</span>
            <span className="text-gray-400 mx-1.5">·</span>
            <span className="tabular-nums font-semibold">{worst.rate}%</span>
            <span className="text-gray-500 text-xs ml-1">
              （{worst.completed}/{worst.total}）
            </span>
            <span className="block text-gray-700 mt-0.5">{worst.text}</span>
          </p>
        </div>
      )}

      {/* AI 総括。長いので既定では畳む */}
      {commonInsights && (
        <div className="border-t border-gray-100 pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
            AI の総括
          </h3>
          <div
            ref={insightRef}
            className={`text-sm text-gray-900 leading-relaxed whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}
          >
            {commonInsights}
          </div>
          {/* 3行に収まっているときは出さない（押しても何も変わらないボタンになるため） */}
          {truncated && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" strokeWidth={2} />
                  閉じる
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
                  続きを見る
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  children,
}: {
  label: string
  value: string | null
  sub: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {value === null ? (
        <p className="text-xl font-semibold text-gray-300 tracking-tight tabular-nums">—</p>
      ) : (
        <p className="text-2xl font-semibold text-gray-900 tracking-tight tabular-nums">{value}</p>
      )}
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
      {children}
    </div>
  )
}
