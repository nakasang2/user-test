import {
  aggregateTasks, aggregateScores, overallSuccess, hardestTask,
  calcNps, type SessionLike,
} from './interview-aggregate'
import type { SlideSummaryResult } from './ai'

/**
 * スライド資料の構成を決める純粋関数群（Google API は一切呼ばない）。
 *
 * 「答えは調査内容による」— セッション数や質問構成によって出せる結論は調査ごとに違うため、
 * 固定枚数のテンプレートにはしない。表示できるデータがあるセクションだけを積み上げる。
 * データが無いセクションは「データなし」のプレースホルダーにせず、黙って省く
 * （発表資料に空スライドを混ぜたくないため）。
 */

export interface SlideEmotion {
  happy: number
  neutral: number
  sad: number
  surprised: number
}

export interface SlideSession extends SessionLike {
  createdAt: Date
  emotions?: SlideEmotion[]
}

export type SlideSection =
  | { kind: 'cover'; title: string; period: string; participantCount: number }
  | { kind: 'summary'; heading: string; items: string[] }
  | {
      kind: 'task-success'
      rate: number
      unaidedRate: number
      completed: number
      total: number
      hardest: { text: string; rate: number } | null
    }
  | { kind: 'task-detail'; rows: { text: string; rate: string; avgDuration: string; hintRate: string }[] }
  | { kind: 'score'; rows: { label: string; value: string }[] }
  | { kind: 'emotion'; rows: { label: string; value: string }[] }
  | { kind: 'highlights'; quotes: string[] }

const MAX_HIGHLIGHTS = 8
const MAX_SCORE_ROWS = 12

/**
 * セッションから集計した「素材」。AIへのサマリー生成プロンプトと、実際のスライドの
 * 両方がこれを見る（同じ数字を2回計算しない／画面と食い違わないようにするため）。
 */
export interface SlideStats {
  participantCount: number
  period: string
  taskSuccess: { rate: number; unaidedRate: number; completed: number; total: number; hardest: { text: string; rate: number } | null } | null
  taskRows: { text: string; rate: string; avgDuration: string; hintRate: string }[]
  scoreRows: { label: string; value: string }[]
  emotionRows: { label: string; value: string }[]
}

/**
 * 非パイロットの全セッションを渡す（ステータス問わず）。タスク成功率・満足度スコアは
 * 画面の「結果サマリー」と同じ母集団（実測値は分析未完了でも含む）。
 * ただし感情の傾向だけは画面のレーダーチャートに合わせ、ここで status === 'done' の
 * セッションに絞り込む（分析系はdoneのみで算出する既存の慣習に揃える。
 * 揃えないと同じ調査で画面とスライドの数字が食い違う）。
 */
export function computeSlideStats(sessions: SlideSession[]): SlideStats {
  const period = sessions.length > 0
    ? (() => {
        const { min, max } = sessions.reduce(
          (acc, s) => {
            const t = s.createdAt.getTime()
            return { min: Math.min(acc.min, t), max: Math.max(acc.max, t) }
          },
          { min: Infinity, max: -Infinity }
        )
        return `${formatDate(new Date(min))} 〜 ${formatDate(new Date(max))}`
      })()
    : '実施実績なし'

  const taskAgg = aggregateTasks(sessions)
  const overall = overallSuccess(taskAgg)
  const worst = overall ? hardestTask(taskAgg) : null
  const taskSuccess = overall
    ? {
        rate: overall.rate,
        unaidedRate: overall.unaidedRate,
        completed: overall.completed,
        total: overall.total,
        hardest: worst ? { text: worst.text, rate: worst.rate } : null,
      }
    : null
  const taskRows = overall
    ? taskAgg
        .filter((t) => t.total > 0)
        .map((t) => ({
          text: t.text,
          rate: `${Math.round((t.completed / t.total) * 100)}%（${t.completed}/${t.total}）`,
          avgDuration: t.durations.length > 0 ? formatDuration(avg(t.durations)) : '—',
          hintRate: `${Math.round((t.hintUsed / t.total) * 100)}%`,
        }))
    : []

  const scoreAgg = aggregateScores(sessions)
  const scoreRows = scoreAgg.slice(0, MAX_SCORE_ROWS).map((s) => {
    const mean = avg(s.values)
    const value = s.type === 'nps'
      ? `NPS ${calcNps(s.values)}（平均 ${mean.toFixed(1)} / 10・n=${s.values.length}）`
      : `平均 ${mean.toFixed(1)} / 5（n=${s.values.length}）`
    return { label: s.text, value }
  })
  if (scoreAgg.length > MAX_SCORE_ROWS) {
    scoreRows.push({ label: `ほか ${scoreAgg.length - MAX_SCORE_ROWS}件`, value: '' })
  }

  const emotionSessions = sessions.filter((s) => s.status === 'done' && s.emotions && s.emotions.length > 0)
  const emotionRows = emotionSessions.length > 0
    ? (() => {
        const emotionAvg = (key: keyof SlideEmotion) =>
          avg(emotionSessions.map((s) => avg(s.emotions!.map((e) => e[key]))))
        return [
          { label: '喜び', value: `${Math.round(emotionAvg('happy') * 100)}%` },
          { label: '中立', value: `${Math.round(emotionAvg('neutral') * 100)}%` },
          { label: '悲しみ', value: `${Math.round(emotionAvg('sad') * 100)}%` },
          { label: '驚き', value: `${Math.round(emotionAvg('surprised') * 100)}%` },
        ]
      })()
    : []

  return { participantCount: sessions.length, period, taskSuccess, taskRows, scoreRows, emotionRows }
}

/** AIにサマリーを書かせるための、定量データの読み上げテキスト表現 */
export function renderStatsText(stats: SlideStats): string {
  const lines: string[] = [`参加者数: ${stats.participantCount}人（実施期間: ${stats.period}）`]
  if (stats.taskSuccess) {
    lines.push(
      `タスク成功率: 全体 ${stats.taskSuccess.rate}%（${stats.taskSuccess.completed}/${stats.taskSuccess.total}回）・自力 ${stats.taskSuccess.unaidedRate}%`
    )
    if (stats.taskSuccess.hardest) {
      lines.push(`最も苦戦したタスク: ${stats.taskSuccess.hardest.text}（成功率 ${stats.taskSuccess.hardest.rate}%）`)
    }
    stats.taskRows.forEach((r) => {
      lines.push(`- タスク「${r.text}」: 成功率 ${r.rate}・平均所要時間 ${r.avgDuration}・ヒント使用率 ${r.hintRate}`)
    })
  }
  stats.scoreRows.forEach((r) => lines.push(`スコア「${r.label}」: ${r.value}`))
  if (stats.emotionRows.length > 0) {
    lines.push(`感情の傾向: ${stats.emotionRows.map((r) => `${r.label} ${r.value}`).join('・')}`)
  }
  return lines.join('\n')
}

/**
 * 集計済みの SlideStats と、既に生成済みのサマリー本文・ハイライトから、
 * 表示できるセクションだけを積み上げる（データが無いセクションは省く）。
 */
export function buildSlideSections(
  title: string,
  stats: SlideStats,
  summary: SlideSummaryResult | null,
  highlights: { quote: string; note: string | null }[]
): SlideSection[] {
  const sections: SlideSection[] = []

  // 表紙は常に出す（実施実績が0件でも、調査自体の存在は示す）
  sections.push({ kind: 'cover', title, period: stats.period, participantCount: stats.participantCount })

  // 事実・仮説・次のアクションは1ページずつ。データが乏しく空配列の項目は省く
  if (summary?.facts.length) {
    sections.push({ kind: 'summary', heading: '事実', items: summary.facts })
  }
  if (summary?.hypotheses.length) {
    sections.push({ kind: 'summary', heading: '仮説', items: summary.hypotheses })
  }
  if (summary?.actions.length) {
    sections.push({ kind: 'summary', heading: '次のアクション', items: summary.actions })
  }

  if (stats.taskSuccess) {
    sections.push({ kind: 'task-success', ...stats.taskSuccess })
    sections.push({ kind: 'task-detail', rows: stats.taskRows })
  }

  if (stats.scoreRows.length > 0) {
    sections.push({ kind: 'score', rows: stats.scoreRows })
  }

  if (stats.emotionRows.length > 0) {
    sections.push({ kind: 'emotion', rows: stats.emotionRows })
  }

  if (highlights.length > 0) {
    sections.push({
      kind: 'highlights',
      quotes: highlights.slice(0, MAX_HIGHLIGHTS).map((h) => (h.note ? `${h.quote}（${h.note}）` : h.quote)),
    })
  }

  return sections
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function formatDuration(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return `${s}秒`
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}
