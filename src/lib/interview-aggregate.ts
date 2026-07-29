import type { TaskResultData, AnswerData } from '@/components/SessionMetrics'

/**
 * 調査（インタビュー）横断の定量集計。
 *
 * 同じ数字を画面の複数箇所で出すため、算出はこのファイルに一本化する。
 * 過去に「_count にフィルタを足したが、画面は別経路の自前集計を表示していた」ため
 * 同じプロダクト内で件数が食い違う事故が起きている。サマリーと詳細で
 * 成功率がズレると、リサーチャーはどちらを信じてよいか分からなくなる。
 */

export interface SessionLike {
  id: string
  participantName: string
  status?: string
  taskResults?: TaskResultData[]
  answers?: AnswerData[]
}

export interface TaskAgg {
  key: string
  text: string
  /** 表示順。編集で振り直されるので集計キーには使わない */
  order: number
  completed: number
  total: number
  durations: number[]
  seqs: number[]
}

export interface ScoreAgg {
  key: string
  text: string
  order: number
  type: string
  values: number[]
}

/** NPS = 推奨者(9-10)% − 批判者(0-6)% */
export function calcNps(values: number[]): number {
  const promoters = values.filter((v) => v >= 9).length
  const detractors = values.filter((v) => v <= 6).length
  return Math.round(((promoters - detractors) / values.length) * 100)
}

/**
 * タスク単位に集約する。
 * キーは order ではなく taskId（無ければ文言）。order は調査を編集して並べ替える
 * たびに振り直されるため、order でまとめると別タスクの結果が合算されてしまう。
 */
export function aggregateTasks(sessions: SessionLike[]): TaskAgg[] {
  const map = new Map<string, TaskAgg>()
  sessions.forEach((s) => {
    s.taskResults?.forEach((t) => {
      const key = t.taskId ?? `text:${t.text}`
      const cur = map.get(key) ?? { key, text: t.text, order: t.order, completed: 0, total: 0, durations: [], seqs: [] }
      cur.total += 1
      cur.order = Math.min(cur.order, t.order) // 表示順は最小の order を採用
      if (t.outcome === 'completed') cur.completed += 1
      if (typeof t.durationSec === 'number' && t.durationSec > 0) cur.durations.push(t.durationSec)
      if (typeof t.seq === 'number') cur.seqs.push(t.seq)
      map.set(key, cur)
    })
  })
  return [...map.values()].sort((a, b) => a.order - b.order)
}

/** スコア質問（rating / nps）を質問単位に集約する。キーは questionId（無ければ文言） */
export function aggregateScores(sessions: SessionLike[]): ScoreAgg[] {
  const map = new Map<string, ScoreAgg>()
  sessions.forEach((s) => {
    s.answers?.forEach((a) => {
      if ((a.type !== 'rating' && a.type !== 'nps') || typeof a.valueNum !== 'number') return
      const key = a.questionId ?? `text:${a.text}`
      const cur = map.get(key) ?? { key, text: a.text, order: a.order, type: a.type, values: [] }
      cur.values.push(a.valueNum)
      cur.order = Math.min(cur.order, a.order)
      map.set(key, cur)
    })
  })
  return [...map.values()].sort((a, b) => a.order - b.order)
}

/** タスク全体の成功率。1件も結果が無ければ null（0% と区別する） */
export function overallSuccess(tasks: TaskAgg[]): { completed: number; total: number; rate: number } | null {
  const total = tasks.reduce((sum, t) => sum + t.total, 0)
  if (total === 0) return null
  const completed = tasks.reduce((sum, t) => sum + t.completed, 0)
  return { completed, total, rate: Math.round((completed / total) * 100) }
}

/**
 * 参加者1人あたりの平均所要時間（秒）。
 * タスクごとの平均ではなく「1人がこのテストに要した時間」を出したいので、
 * まずセッション単位で合計してから人数で割る。
 */
export function avgSessionDuration(sessions: SessionLike[]): number | null {
  const totals = sessions
    .map((s) => (s.taskResults ?? []).reduce((sum, t) => sum + (typeof t.durationSec === 'number' && t.durationSec > 0 ? t.durationSec : 0), 0))
    .filter((v) => v > 0)
  if (totals.length === 0) return null
  return totals.reduce((a, b) => a + b, 0) / totals.length
}

/**
 * 代表スコアを1つ選ぶ。NPS があれば最優先（業界標準の指標なので見出しに向く）、
 * 無ければ最初の評価質問の平均を返す。
 */
export function headlineScore(scores: ScoreAgg[]):
  | { kind: 'nps'; value: number; mean: number; n: number; text: string }
  | { kind: 'rating'; mean: number; n: number; text: string }
  | null {
  const nps = scores.find((s) => s.type === 'nps')
  if (nps) {
    const mean = nps.values.reduce((a, b) => a + b, 0) / nps.values.length
    return { kind: 'nps', value: calcNps(nps.values), mean, n: nps.values.length, text: nps.text }
  }
  const rating = scores.find((s) => s.type === 'rating')
  if (rating) {
    const mean = rating.values.reduce((a, b) => a + b, 0) / rating.values.length
    return { kind: 'rating', mean, n: rating.values.length, text: rating.text }
  }
  return null
}

/**
 * 最も成功率が低いタスク。全問 100% なら null（警告を出す意味がない）。
 * 同率のときは order が小さい方（先に出てくる方）を返す。
 */
export function hardestTask(tasks: TaskAgg[]): (TaskAgg & { rate: number }) | null {
  const withRate = tasks.filter((t) => t.total > 0).map((t) => ({ ...t, rate: Math.round((t.completed / t.total) * 100) }))
  if (withRate.length === 0) return null
  const worst = withRate.reduce((min, t) => (t.rate < min.rate ? t : min), withRate[0])
  return worst.rate >= 100 ? null : worst
}
