import {
  aggregateTasks, aggregateScores, overallSuccess, hardestTask,
  calcNps, avgSessionDuration, type SessionLike,
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
  | { kind: 'kpi'; items: { label: string; value: string }[] }
  | { kind: 'intro'; objective: string | null; description: string | null }
  | { kind: 'stimulus'; imageUrl: string | null; caption: string }
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
  | { kind: 'score'; rows: { label: string; value: string; percent: number }[] }
  | { kind: 'score-distribution'; questionText: string; buckets: { label: string; count: number; percent: number }[] }
  | { kind: 'emotion'; rows: { label: string; value: string; percent: number }[] }
  | { kind: 'participants'; rows: { name: string; status: string; taskSummary: string; scoreSummary: string }[] }
  | { kind: 'highlights'; quotes: string[] }

const MAX_HIGHLIGHTS = 8
const MAX_SCORE_ROWS = 12
const MAX_TASK_ROWS = 12
const MAX_PARTICIPANT_ROWS = 14
const MAX_DISTRIBUTION_QUESTIONS = 3

const STATUS_LABEL: Record<string, string> = {
  pending: '待機中', active: '進行中', processing: '分析中', done: '分析済み', completed: '完了',
}

/**
 * セッションから集計した「素材」。AIへのサマリー生成プロンプトと、実際のスライドの
 * 両方がこれを見る（同じ数字を2回計算しない／画面と食い違わないようにするため）。
 */
export interface SlideStats {
  participantCount: number
  period: string
  avgDuration: string | null
  taskSuccess: { rate: number; unaidedRate: number; completed: number; total: number; hardest: { text: string; rate: number } | null } | null
  taskRows: { text: string; rate: string; avgDuration: string; hintRate: string }[]
  scoreRows: { label: string; value: string; percent: number }[]
  scoreDistributions: { questionText: string; buckets: { label: string; count: number; percent: number }[] }[]
  emotionRows: { label: string; value: string; percent: number }[]
  participantRows: { name: string; status: string; taskSummary: string; scoreSummary: string }[]
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
  const taskRowsAll = overall
    ? taskAgg
        .filter((t) => t.total > 0)
        .map((t) => ({
          text: t.text,
          rate: `${Math.round((t.completed / t.total) * 100)}%（${t.completed}/${t.total}）`,
          avgDuration: t.durations.length > 0 ? formatDuration(avg(t.durations)) : '—',
          hintRate: `${Math.round((t.hintUsed / t.total) * 100)}%`,
        }))
    : []
  // タスク数が多い調査でスライドが際限なく縦長にならないよう上限を設ける
  // （超えた分は画面上でも確認できるので、スライドでは「ほか n件」だけ示せば十分）
  const taskRows = taskRowsAll.slice(0, MAX_TASK_ROWS)
  if (taskRowsAll.length > MAX_TASK_ROWS) {
    taskRows.push({ text: `ほか ${taskRowsAll.length - MAX_TASK_ROWS}件`, rate: '', avgDuration: '', hintRate: '' })
  }

  const scoreAgg = aggregateScores(sessions)
  const scoreRows = scoreAgg.slice(0, MAX_SCORE_ROWS).map((s) => {
    const mean = avg(s.values)
    // 棒グラフ用に「尺度に対する割合」に正規化する（NPSは0-10、5段階評価は1-5）
    const percent = s.type === 'nps'
      ? clampPercent((mean / 10) * 100)
      : clampPercent(((mean - 1) / 4) * 100)
    const value = s.type === 'nps'
      ? `NPS ${calcNps(s.values)}（平均 ${mean.toFixed(1)} / 10・n=${s.values.length}）`
      : `平均 ${mean.toFixed(1)} / 5（n=${s.values.length}）`
    return { label: s.text, value, percent }
  })
  if (scoreAgg.length > MAX_SCORE_ROWS) {
    scoreRows.push({ label: `ほか ${scoreAgg.length - MAX_SCORE_ROWS}件`, value: '', percent: 0 })
  }

  // 平均だけでは「何人が高評価/低評価だったか」が分からないため、代表的な質問だけ内訳も出す
  // （質問数が多い調査でスライドが際限なく増えないよう上限を設ける）
  const scoreDistributions = scoreAgg
    .slice(0, MAX_DISTRIBUTION_QUESTIONS)
    .map((s) => {
      const total = s.values.length
      const buckets = s.type === 'nps'
        ? (() => {
            const counts = [0, 0, 0]
            s.values.forEach((v) => {
              if (v <= 6) counts[0] += 1
              else if (v <= 8) counts[1] += 1
              else counts[2] += 1
            })
            const labels = ['批判者（0-6点）', '中立（7-8点）', '推奨者（9-10点）']
            return labels.map((label, i) => ({ label, count: counts[i], percent: clampPercent((counts[i] / total) * 100) }))
          })()
        : (() => {
            const counts = [0, 0, 0, 0, 0]
            s.values.forEach((v) => {
              const idx = Math.round(v) - 1
              if (idx >= 0 && idx < counts.length) counts[idx] += 1
            })
            return counts.map((count, i) => ({ label: `${i + 1}点`, count, percent: clampPercent((count / total) * 100) }))
          })()
      return { questionText: s.text, buckets }
    })
    .filter((d) => d.buckets.some((b) => b.count > 0))

  const emotionSessions = sessions.filter((s) => s.status === 'done' && s.emotions && s.emotions.length > 0)
  const emotionRows = emotionSessions.length > 0
    ? (() => {
        const emotionAvg = (key: keyof SlideEmotion) =>
          avg(emotionSessions.map((s) => avg(s.emotions!.map((e) => e[key]))))
        const toRow = (label: string, key: keyof SlideEmotion) => {
          const percent = clampPercent(emotionAvg(key) * 100)
          return { label, value: `${Math.round(percent)}%`, percent }
        }
        return [
          toRow('喜び', 'happy'),
          toRow('中立', 'neutral'),
          toRow('悲しみ', 'sad'),
          toRow('驚き', 'surprised'),
        ]
      })()
    : []

  const duration = avgSessionDuration(sessions)
  const avgDuration = duration ? formatDuration(duration.mean) : null

  const participantRows = sessions.map((s) => {
    const tasks = (s.taskResults ?? []).filter((t) => !t.excludedAt && t.outcome !== 'not_attempted')
    const taskSummary = tasks.length > 0
      ? `${tasks.filter((t) => t.outcome === 'completed').length}/${tasks.length}件成功`
      : '—'
    const scoreValues = (s.answers ?? [])
      .filter((a): a is typeof a & { valueNum: number } =>
        !a.excludedAt && (a.type === 'rating' || a.type === 'nps') && typeof a.valueNum === 'number'
      )
      .map((a) => a.valueNum)
    const scoreSummary = scoreValues.length > 0 ? `平均 ${avg(scoreValues).toFixed(1)}` : '—'
    return {
      name: s.participantName,
      status: STATUS_LABEL[s.status ?? ''] ?? (s.status ?? '—'),
      taskSummary,
      scoreSummary,
    }
  })

  return {
    participantCount: sessions.length, period, avgDuration, taskSuccess, taskRows,
    scoreRows, scoreDistributions, emotionRows, participantRows,
  }
}

/** AIにサマリーを書かせるための、定量データの読み上げテキスト表現 */
export function renderStatsText(stats: SlideStats): string {
  const lines: string[] = [`参加者数: ${stats.participantCount}人（実施期間: ${stats.period}）`]
  if (stats.avgDuration) {
    lines.push(`平均所要時間: ${stats.avgDuration}`)
  }
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

export interface BuildSlideSectionsInput {
  title: string
  stats: SlideStats
  /** 目的・説明。両方 null なら「目的・概要」スライド自体を出さない */
  intro: { objective: string | null; description: string | null } | null
  /** 印象テストの提示画像／ユーザビリティテストの対象サイト・プロトタイプ */
  stimulus: { imageUrl: string | null; caption: string } | null
  summary: SlideSummaryResult | null
  highlights: { quote: string; note: string | null }[]
}

/**
 * 集計済みの SlideStats と、既に生成済みのサマリー本文・ハイライトから、
 * 表示できるセクションだけを積み上げる（データが無いセクションは省く）。
 */
export function buildSlideSections(input: BuildSlideSectionsInput): SlideSection[] {
  const { title, stats, intro, stimulus, summary, highlights } = input
  const sections: SlideSection[] = []

  // 表紙は常に出す（実施実績が0件でも、調査自体の存在は示す）
  sections.push({ kind: 'cover', title, period: stats.period, participantCount: stats.participantCount })

  // 表紙の直後に、主要な数値だけを1枚にまとめた「全体像」を置く（詳細は後続のスライドで）
  const kpiItems: { label: string; value: string }[] = []
  if (stats.taskSuccess) {
    kpiItems.push({ label: 'タスク成功率', value: `${stats.taskSuccess.rate}%` })
    kpiItems.push({ label: '自力成功率', value: `${stats.taskSuccess.unaidedRate}%` })
  }
  if (stats.scoreRows[0]) {
    // KPIカードは数値だけを大きく見せる場所なので、内訳（n数など）を含む長い文字列ではなく
    // 先頭の短い表記（「NPS 12」「平均 4.2 / 5」）だけを使う
    const shortValue = stats.scoreRows[0].value.split('（')[0].trim()
    kpiItems.push({ label: stats.scoreRows[0].label, value: shortValue })
  }
  const positiveEmotion = stats.emotionRows.find((r) => r.label === '喜び')
  if (positiveEmotion) {
    kpiItems.push({ label: 'ポジティブ感情の割合', value: positiveEmotion.value })
  }
  if (stats.avgDuration) {
    kpiItems.push({ label: '平均所要時間', value: stats.avgDuration })
  }
  if (highlights.length > 0) {
    kpiItems.push({ label: '注目発言', value: `${highlights.length}件` })
  }
  if (kpiItems.length > 0) {
    sections.push({ kind: 'kpi', items: kpiItems })
  }

  // 目的・概要はテスト対象の可視化より先、冒頭に出す
  if (intro && (intro.objective || intro.description)) {
    sections.push({ kind: 'intro', objective: intro.objective, description: intro.description })
  }

  if (stimulus) {
    sections.push({ kind: 'stimulus', ...stimulus })
  }

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

  // 平均だけでなく「何人が高評価/低評価だったか」の内訳（代表的な質問のみ、上限あり）
  stats.scoreDistributions.forEach((d) => {
    sections.push({ kind: 'score-distribution', questionText: d.questionText, buckets: d.buckets })
  })

  if (stats.emotionRows.length > 0) {
    sections.push({ kind: 'emotion', rows: stats.emotionRows })
  }

  // 参加者ごとの結果一覧（誰がどのタスクで詰まったか等を個別に追える一覧）
  if (stats.participantRows.length > 0) {
    const rows = stats.participantRows.slice(0, MAX_PARTICIPANT_ROWS)
    if (stats.participantRows.length > MAX_PARTICIPANT_ROWS) {
      rows.push({
        name: `ほか ${stats.participantRows.length - MAX_PARTICIPANT_ROWS}件`,
        status: '', taskSummary: '', scoreSummary: '',
      })
    }
    sections.push({ kind: 'participants', rows })
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

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n))
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function formatDuration(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return `${s}秒`
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}
