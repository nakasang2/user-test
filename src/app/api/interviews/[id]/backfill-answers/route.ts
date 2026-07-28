import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractAnswersFromTranscript, classifyAnswerSentiments } from '@/lib/ai'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

// セッション数ぶん AI を呼ぶため、既定の実行時間上限では足りない
export const maxDuration = 300

/**
 * POST /api/interviews/[id]/backfill-answers
 * — 回答が構造化保存されていない過去セッションについて、文字起こしから回答を復元する。
 *
 * 回答テーブル（Answer）を導入する前に実施したセッションは、回答が文字起こしの中に
 * しか無く、質問×参加者の比較テーブルに載らない。これを後から埋めるための処理。
 *
 * 既に回答があるセッションは触らない（実施中に保存した本物の記録を上書きしないため）。
 */

/** 1リクエストで処理するセッション数の上限。多い場合は繰り返し実行してもらう。 */
const BATCH = 5
/** 実行時間の予算（ミリ秒）。超えたら打ち切り、残りは次回に回す。 */
const TIME_BUDGET_MS = 210_000

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params
    if (!(await rateLimit(`backfill:${orgId}:${getClientIp(req)}`, 5, 300))) {
      return NextResponse.json({ error: 'しばらく時間をおいてから再度お試しください' }, { status: 429 })
    }

    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: {
        questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, order: true, type: true } },
        sessions: {
          // パイロットと、既に回答があるセッションは対象外。
          // 実施中（pending/active）も除外する。実施中は被験者側が本物の回答を
          // 書き込む可能性があり、AI の再構成で上書きしてしまう恐れがあるため。
          where: {
            isPilot: false,
            answers: { none: {} },
            status: { in: ['done', 'completed', 'processing'] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            transcript: {
              select: { segments: { orderBy: { startTime: 'asc' }, select: { speaker: true, text: true } } },
            },
          },
        },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const questions = interview.questions
    if (questions.length === 0) {
      return NextResponse.json({ error: 'この調査には質問が登録されていません' }, { status: 400 })
    }

    // 文字起こしがあるものだけを対象にする
    const targets = interview.sessions.filter((s) => (s.transcript?.segments.length ?? 0) > 0)
    const batch = targets.slice(0, BATCH)

    let filled = 0
    let failed = 0
    let processed = 0
    const startedAt = Date.now()

    for (const session of batch) {
      // 予算を超えたら打ち切る（504 で結果が返らないのを避ける）
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
      processed += 1
      try {
        const text = (session.transcript?.segments ?? [])
          .map((seg) => `${seg.speaker}: ${seg.text}`)
          .join('\n')

        const extracted = await extractAnswersFromTranscript(questions.map((q) => q.text), text)
        const entries = Object.entries(extracted)
        if (entries.length === 0) continue

        // 抽出した回答の肯定/否定も付ける（実施中に保存した回答と同じ見え方にする）
        let judged: Record<string, 'positive' | 'neutral' | 'negative'> = {}
        try {
          judged = await classifyAnswerSentiments(
            entries.map(([qi, v]) => ({ question: questions[Number(qi)].text, answer: v.answer })),
          )
        } catch (err) {
          console.error('backfill: classify failed', err)
        }

        // 既にある行は絶対に上書きしない（skipDuplicates）。
        // 実施中に保存された本物の回答を、AI の再構成で置き換えないため。
        type AnswerRow = {
          sessionId: string
          questionId: string
          order: number
          text: string
          type: string
          valueNum?: number
          valueText?: string
          followUpCount?: number
          sentiment?: string | null
        }
        const rows = entries.flatMap(([qi, v], i): AnswerRow[] => {
          const q = questions[Number(qi)]
          const type = q.type === 'rating' || q.type === 'nps' ? q.type : 'open'

          // スコア質問は文字起こしに「4（4 / 5）」の形で残っているので数値を復元する。
          // 数値が取れない場合はこの質問を諦める（スコアの枠にテキストを入れない）。
          if (type !== 'open') {
            const m = v.answer.match(/-?\d+/)
            const n = m ? Number(m[0]) : NaN
            const max = type === 'nps' ? 10 : 5
            const min = type === 'nps' ? 0 : 1
            if (!Number.isInteger(n) || n < min || n > max) return []
            return [{
              sessionId: session.id,
              questionId: q.id,
              order: q.order,
              text: q.text,
              type,
              valueNum: n,
            }]
          }

          return [{
            sessionId: session.id,
            questionId: q.id,
            order: q.order,
            text: q.text,
            type,
            valueText: v.answer,
            followUpCount: v.followUpCount,
            sentiment: judged[String(i)] ?? null,
          }]
        })
        if (rows.length === 0) continue
        await prisma.answer.createMany({ data: rows, skipDuplicates: true })
        filled += 1
      } catch (err) {
        console.error('backfill failed for session', session.id, err)
        failed += 1
      }
    }

    return NextResponse.json({
      ok: true,
      filled,
      failed,
      // まだ残っていれば、もう一度実行してもらう
      remaining: Math.max(0, targets.length - processed),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
