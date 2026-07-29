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

/*
 * 【既知の課題】削除済みタスク・質問の結果が集計に残り続ける
 *
 * タスクを削除すると TaskResult.taskId は SetNull になる（結果自体は残す設計）。
 * そのため削除済みタスクの結果は「文言キー」の行として生き残り、集計に混ざる。
 *
 * 「現在のタスク一覧と文言で突き合わせて、一致しないものを削除済みとみなす」実装を
 * 一度入れたが、取りやめた。TaskResult.text は実施時点のスナップショットなので、
 * タスクの文言を修正しただけ（タスクは存在する）でも旧データが一致しなくなり、
 * 「削除済み」と誤判定されて集計から落ちる。落ちるのは古いデータに偏るため、
 * 数字が実態より良く見える方向にズレる。気づけない誤りなので、
 * 「削除済みが混ざる」ほうを選んでいる（混ざっても行として画面に見えるため気づける）。
 *
 * 恒久対応するなら、TaskResult に「削除時点で確定した除外フラグ」を持たせるなど
 * スナップショット文言に依存しない方法が要る。
 */

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
export function avgSessionDuration(sessions: SessionLike[]): { mean: number; n: number } | null {
  const totals = sessions
    .map((s) =>
      (s.taskResults ?? []).reduce(
        (sum, t) => sum + (typeof t.durationSec === 'number' && t.durationSec > 0 ? t.durationSec : 0),
        0
      )
    )
    .filter((v) => v > 0)
  if (totals.length === 0) return null
  // n も返す。計測できた人だけの平均なので、母数が分からないと誤読される
  return { mean: totals.reduce((a, b) => a + b, 0) / totals.length, n: totals.length }
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
 *
 * 試行回数が極端に少ない行は除外する。旧データが文言違いで分裂した断片は
 * n=1 になりがちで、そのままだと「0%（0/1）」が本当の問題箇所（例 2/9）を
 * 押しのけて見出しに出てしまう。
 *
 * 基準は「3回以上試行されていること」。全体の割合（例: 最多の半数）にすると、
 * 調査の途中で追加したタスク（10人中4人しか実施していない等）が本当に
 * 成功率 0% でも警告が出なくなるため、絶対値で持つ。
 * どのタスクも3回に届かない小規模な調査では、その中の最大値まで基準を下げる。
 */
export function hardestTask(tasks: TaskAgg[]): (TaskAgg & { rate: number }) | null {
  const done = tasks.filter((t) => t.total > 0)
  if (done.length === 0) return null
  const maxTotal = Math.max(...done.map((t) => t.total))
  const minTotal = Math.min(3, maxTotal)
  const eligible = done
    .filter((t) => t.total >= minTotal)
    .map((t) => ({ ...t, rate: Math.round((t.completed / t.total) * 100) }))
  if (eligible.length === 0) return null
  const worst = eligible.reduce((min, t) => (t.rate < min.rate ? t : min), eligible[0])
  // 丸め前で判定する（199/200 が 100% に丸まって警告が消えるのを防ぐ）
  return worst.completed >= worst.total ? null : worst
}
