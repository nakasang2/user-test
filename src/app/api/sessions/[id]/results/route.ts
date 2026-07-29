import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

/**
 * POST /api/sessions/[id]/results — 測定結果（タスク達成/断念・評価回答）の保存（被験者フロー）。
 *
 * 文字起こしとは別テーブルに構造化して持つ。これにより
 *   - タスク成功率 / 所要時間 / NPS・評価平均を SQL で集計できる
 *   - 再文字起こし（/transcribe がセグメントを全置換する）でも結果が消えない
 *
 * 保存は (sessionId, order) をキーにした行単位の upsert。全置換にしないのは、
 *   - 送信が並行しても行が重複・消失しない（DB の unique 制約で担保）
 *   - 途中リロードで手元の記録が空になっても、既存の結果を消さない
 * ため。遅延した古いリクエストは同じ行を同じ値で上書きするだけで害がない。
 */

type TaskResultInput = {
  taskId?: string | null
  order: number
  text: string
  outcome: string
  startedAt?: number | null
  endedAt?: number | null
  seq?: number | null
  usedHint?: boolean
  assistedStart?: boolean
}

type AnswerInput = {
  questionId?: string | null
  order: number
  text: string
  type: string
  valueNum?: number | null
  valueText?: string | null
  followUpCount?: number | null
  answeredAt?: number | null
}

// not_attempted = 前のタスク（前提タスク）を達成できず、着手する機会が無かった。
// 集計では試行回数（分母）から外すので、gave_up とは別の値として受け取る。
const OUTCOMES = ['completed', 'gave_up', 'not_attempted']
const ANSWER_TYPES = ['open', 'rating', 'nps']

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** 文字列を安全な長さに丸める（過大なペイロードで DB を膨らませない） */
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : ''

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    if (!(await rateLimit(`results:${id}:${getClientIp(req)}`, 120, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    await requireParticipantToken(id, req.headers.get('x-participant-token'))

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const rawTasks = Array.isArray(body.taskResults) ? body.taskResults : []
    const rawAnswers = Array.isArray(body.answers) ? body.answers : []

    // 上限を設けて暴走を防ぐ（通常はタスク・質問とも十数件）
    const taskResults = (rawTasks as TaskResultInput[])
      .slice(0, 100)
      .filter((t) => OUTCOMES.includes(t.outcome))
      .map((t) => {
        const startedAt = num(t.startedAt)
        const endedAt = num(t.endedAt)
        return {
          sessionId: id,
          taskId: typeof t.taskId === 'string' ? t.taskId : null,
          order: num(t.order) ?? 0,
          text: str(t.text, 2000),
          outcome: t.outcome,
          startedAt,
          endedAt,
          // 未実施は所要時間を持たない。着手していないので、経過秒があっても
          // それは前のタスクで詰まっていた時間であり、time on task ではない
          durationSec:
            t.outcome !== 'not_attempted' && startedAt !== null && endedAt !== null && endedAt >= startedAt
              ? endedAt - startedAt
              : null,
          // SEQ は 1〜7 の整数のみ受け付ける
          seq: (() => {
            const v = num(t.seq)
            return v !== null && Number.isInteger(v) && v >= 1 && v <= 7 ? v : null
          })(),
          usedHint: t.usedHint === true,
          assistedStart: t.assistedStart === true,
        }
      })

    const answers = (rawAnswers as AnswerInput[])
      .slice(0, 200)
      .filter((a) => ANSWER_TYPES.includes(a.type))
      .map((a) => ({
        sessionId: id,
        questionId: typeof a.questionId === 'string' ? a.questionId : null,
        order: num(a.order) ?? 0,
        text: str(a.text, 2000),
        type: a.type,
        valueNum: num(a.valueNum),
        valueText: typeof a.valueText === 'string' ? a.valueText.slice(0, 4000) : null,
        followUpCount: (() => {
          const v = num(a.followUpCount)
          return v !== null && Number.isInteger(v) && v >= 0 && v <= 50 ? v : null
        })(),
        answeredAt: num(a.answeredAt),
      }))

    // taskId / questionId は「このセッションのインタビューに属するもの」だけを採用する。
    // 存在しない ID をそのまま FK に入れると外部キー違反で保存全体が落ちるため。
    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        interview: {
          select: { tasks: { select: { id: true } }, questions: { select: { id: true } } },
        },
      },
    })
    const validTaskIds = new Set(session?.interview.tasks.map((t) => t.id) ?? [])
    const validQuestionIds = new Set(session?.interview.questions.map((q) => q.id) ?? [])

    /*
     * excludedAt（集計対象外の印）の扱い。
     *
     * 行のキーは (sessionId, order) なので、調査からタスクを削除して順番が詰まると
     * 「印が付いた枠」に別タスクの結果が入りうる。かといって保存のたびに印を消すと、
     * 実施中のセッションは saveResults() で毎回その時点の全件を再送するため、
     * 削除直後の再送で印が黙って外れ、削除済みタスクの結果が全体指標に復活してしまう。
     *
     * そこで「紐付き先が別の現存項目に変わったときだけ」印を外す。
     *   - 同じタスクの再送 → id が同じ → 印はそのまま（手動で外した分も守られる）
     *   - 削除済みタスクの再送 → id が解決できず null → 何もしない（印はそのまま）
     *   - 枠が別の現存タスクに再利用された → id が変わる → 印を外す
     * $transaction は配列順に実行されるので、必ず upsert より前に置く。
     */
    // Prisma の `not` は NULL 行に当たらないので、null を明示的に OR で含める
    const clearTaskFlag = (newId: string | null, order: number) =>
      newId
        ? [prisma.taskResult.updateMany({
            where: {
              sessionId: id, order, excludedAt: { not: null },
              OR: [{ taskId: null }, { taskId: { not: newId } }],
            },
            data: { excludedAt: null },
          })]
        : []

    const clearAnswerFlag = (newId: string | null, order: number) =>
      newId
        ? [prisma.answer.updateMany({
            where: {
              sessionId: id, order, excludedAt: { not: null },
              OR: [{ questionId: null }, { questionId: { not: newId } }],
            },
            data: { excludedAt: null },
          })]
        : []

    // (sessionId, order) をキーに行単位で upsert（並行送信に強い）
    await prisma.$transaction([
      ...taskResults.flatMap((t) => {
        const data = { ...t, taskId: t.taskId && validTaskIds.has(t.taskId) ? t.taskId : null }
        const { sessionId: _s, order: _o, ...update } = data
        void _s; void _o
        return [
          ...clearTaskFlag(data.taskId, data.order),
          prisma.taskResult.upsert({
            where: { sessionId_order: { sessionId: id, order: data.order } },
            create: data,
            update,
          }),
        ]
      }),
      ...answers.flatMap((a) => {
        const data = { ...a, questionId: a.questionId && validQuestionIds.has(a.questionId) ? a.questionId : null }
        const { sessionId: _s, order: _o, ...update } = data
        void _s; void _o
        return [
          ...clearAnswerFlag(data.questionId, data.order),
          prisma.answer.upsert({
            where: { sessionId_order: { sessionId: id, order: data.order } },
            create: data,
            update,
          }),
        ]
      }),
    ])

    return NextResponse.json({
      ok: true,
      saved: { taskResults: taskResults.length, answers: answers.length },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
