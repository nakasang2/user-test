import {
  aggregateTasks, aggregateScores, overallSuccess, hardestTask,
  calcNps, type SessionLike,
} from './interview-aggregate'

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

export interface SlideDeckInput {
  title: string
  /**
   * 非パイロットの全セッションを渡す（ステータス問わず）。タスク成功率・満足度スコアは
   * 画面の「結果サマリー」と同じ母集団（実測値は分析未完了でも含む）。
   * ただし感情の傾向だけは画面のレーダーチャートに合わせて buildSlideSections 内で
   * status === 'done' のセッションに絞り込む（分析系はdoneのみで算出する既存の慣習に揃える）
   */
  sessions: SlideSession[]
  /** 既に生成済みの共通インサイト。null なら該当セクションを出さない */
  commonInsights: string | null
  /** リサーチャーが付けたハイライト（新しい順） */
  highlights: { quote: string; note: string | null }[]
}

export type SlideSection =
  | { kind: 'cover'; title: string; period: string; participantCount: number }
  | { kind: 'summary'; text: string }
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

export function buildSlideSections(input: SlideDeckInput): SlideSection[] {
  const sections: SlideSection[] = []
  const sessions = input.sessions

  // 表紙は常に出す（実施実績が0件でも、調査自体の存在は示す）
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
  sections.push({ kind: 'cover', title: input.title, period, participantCount: sessions.length })

  if (input.commonInsights) {
    sections.push({ kind: 'summary', text: input.commonInsights })
  }

  const taskAgg = aggregateTasks(sessions)
  const overall = overallSuccess(taskAgg)
  if (overall) {
    const worst = hardestTask(taskAgg)
    sections.push({
      kind: 'task-success',
      rate: overall.rate,
      unaidedRate: overall.unaidedRate,
      completed: overall.completed,
      total: overall.total,
      hardest: worst ? { text: worst.text, rate: worst.rate } : null,
    })
    sections.push({
      kind: 'task-detail',
      rows: taskAgg
        .filter((t) => t.total > 0)
        .map((t) => ({
          text: t.text,
          rate: `${Math.round((t.completed / t.total) * 100)}%（${t.completed}/${t.total}）`,
          avgDuration: t.durations.length > 0 ? formatDuration(avg(t.durations)) : '—',
          hintRate: `${Math.round((t.hintUsed / t.total) * 100)}%`,
        })),
    })
  }

  const scoreAgg = aggregateScores(sessions)
  if (scoreAgg.length > 0) {
    const rows = scoreAgg.slice(0, MAX_SCORE_ROWS).map((s) => {
      const mean = avg(s.values)
      const value = s.type === 'nps'
        ? `NPS ${calcNps(s.values)}（平均 ${mean.toFixed(1)} / 10・n=${s.values.length}）`
        : `平均 ${mean.toFixed(1)} / 5（n=${s.values.length}）`
      return { label: s.text, value }
    })
    if (scoreAgg.length > MAX_SCORE_ROWS) {
      rows.push({ label: `ほか ${scoreAgg.length - MAX_SCORE_ROWS}件`, value: '' })
    }
    sections.push({ kind: 'score', rows })
  }

  // 感情の傾向は画面のレーダーチャートと同じ母集団（分析済み=done のみ）に揃える。
  // タスク成功率・満足度スコアと違い、感情は「分析系」として done のみで算出する慣習に合わせる
  // （合わせないと同じ調査で画面とスライドの数字が食い違う）
  const emotionSessions = sessions.filter((s) => s.status === 'done' && s.emotions && s.emotions.length > 0)
  if (emotionSessions.length > 0) {
    const emotionAvg = (key: keyof SlideEmotion) =>
      avg(emotionSessions.map((s) => avg(s.emotions!.map((e) => e[key]))))
    sections.push({
      kind: 'emotion',
      rows: [
        { label: '喜び', value: `${Math.round(emotionAvg('happy') * 100)}%` },
        { label: '中立', value: `${Math.round(emotionAvg('neutral') * 100)}%` },
        { label: '悲しみ', value: `${Math.round(emotionAvg('sad') * 100)}%` },
        { label: '驚き', value: `${Math.round(emotionAvg('surprised') * 100)}%` },
      ],
    })
  }

  if (input.highlights.length > 0) {
    sections.push({
      kind: 'highlights',
      quotes: input.highlights
        .slice(0, MAX_HIGHLIGHTS)
        .map((h) => (h.note ? `${h.quote}（${h.note}）` : h.quote)),
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
