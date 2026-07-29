/**
 * タスクが地続き（前のタスクの結果が次の前提になる）調査での進行判定。
 *
 * メイン画面（InterviewRoom）と小窓（widget）の両方で同じ判定が要る。
 * 小窓は「この先タスクが残るか」で録画を止めるかどうかを決め、メインは
 * 「どこまでを未実施として記録し、どこから再開するか」を決める。
 * 判定が2箇所でズレると、録画が届かない／未実施の範囲が食い違うため一本化する。
 */

export interface TaskFlowItem {
  /** このタスクの結果が次のタスクの前提になるか */
  isPrerequisite?: boolean | null
}

/**
 * idx のタスクの前提を満たせなかったとき、着手できないタスクの範囲を返す。
 *
 * 直後のタスクは必ず着手できない。そのタスク自身も「次の前提」なら、
 * さらに次も始められないので連鎖して未実施になる。前提の印が切れた
 * ところで連鎖は止まり、その次のタスクから再開できる。
 *
 * @returns blocked=未実施にするタスクの添字（0始まり）/ resume=再開するタスクの添字
 *          （tasks.length 以上なら、この先に実施できるタスクは無い）
 */
export function blockedAfter(tasks: TaskFlowItem[], idx: number): { blocked: number[]; resume: number } {
  const blocked: number[] = []
  let j = idx + 1
  while (j < tasks.length) {
    blocked.push(j)
    if (tasks[j].isPrerequisite !== true) break
    j++
  }
  // ループが末尾で抜けた場合（残り全部が連鎖）は tasks.length に丸める。
  // そのまま j+1 を返すと範囲外を1つ超えた値になり、tasks[resume] を引く
  // 実装が後から入ったときに崩れる
  return { blocked, resume: Math.min(j + 1, tasks.length) }
}

/**
 * idx のタスクを断念したときに、立て直し（次のタスクの開始地点への案内）が必要か。
 * 前提タスクであっても、次のタスクが無ければ案内する意味は無い。
 */
export function needsRecovery(tasks: TaskFlowItem[], idx: number): boolean {
  return tasks[idx]?.isPrerequisite === true && idx + 1 < tasks.length
}

/**
 * 結果の表示ラベル。画面と CSV で表現が食い違わないよう一箇所に持つ。
 * 未実施を「できなかった」と書いてしまうと、CSV を手元で集計した人が
 * 着手できなかった分まで失敗として数えてしまう。
 */
export function outcomeLabel(outcome: string): string {
  if (outcome === 'completed') return '達成'
  if (outcome === 'not_attempted') return '未実施（前提を満たせず）'
  return 'できなかった'
}
