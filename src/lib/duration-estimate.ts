/**
 * 調査の所要時間の見積もり。
 *
 * 従来は参加ページに「約 15〜30 分」を直書きしていたため、質問1問の調査でも
 * 100問の調査でも同じ表示になり、被験者への説明として機能していなかった。
 * 設問構成から算出し、幅を持たせて提示する。
 */

export interface EstimateInput {
  /** 質問の形式ごとの件数 */
  openQuestions: number
  /** rating / nps などクリックで答える設問 */
  scaleQuestions: number
  /** ユーザビリティテストのタスク数 */
  tasks: number
  /** タスクごとに SEQ を聞くか */
  seqEnabled?: boolean
  /** 参加前の事前質問（スクリーニング）の数 */
  screeners?: number
}

// 1件あたりの目安（分）。AI が読み上げ、被験者が声に出して答える前提で置いている。
const MIN_PER = {
  setup: 3,        // 説明・カメラ許可・（サービスモードなら録画開始）
  open: 2,         // 自由回答（AI の深掘りが入りうる）
  scale: 0.4,      // クリックで答える設問
  task: 3,         // 1タスクの操作
  seq: 0.3,        // タスクごとの SEQ
  screener: 0.3,   // 事前質問
  closing: 1,      // 終了処理
}

/**
 * 見積もり時間（分）を下限・上限で返す。
 * 個人差が大きいので中央値ではなく幅で示し、5分単位に丸める。
 */
export function estimateMinutes(input: EstimateInput): { min: number; max: number } {
  const { openQuestions, scaleQuestions, tasks, seqEnabled, screeners = 0 } = input

  const base =
    MIN_PER.setup +
    MIN_PER.closing +
    openQuestions * MIN_PER.open +
    scaleQuestions * MIN_PER.scale +
    tasks * MIN_PER.task +
    (seqEnabled ? tasks * MIN_PER.seq : 0) +
    screeners * MIN_PER.screener

  // 被験者による差を ±35% で見込む
  const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)
  const min = roundTo5(base * 0.75)
  const max = roundTo5(base * 1.35)

  // 丸めで同じ値になったら、上限を1段階上げて「幅」として成立させる
  return { min, max: max > min ? max : min + 5 }
}

/** 「約 15〜30 分」のような表示用文字列 */
export function formatEstimate(input: EstimateInput): string {
  const { min, max } = estimateMinutes(input)
  return `約 ${min}〜${max} 分`
}
