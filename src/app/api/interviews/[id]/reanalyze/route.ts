import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { analyzeAndSaveSession } from '@/lib/analyze-session'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

// セッション数ぶん AI を呼ぶため、既定の実行時間上限では足りない
export const maxDuration = 300

/**
 * POST /api/interviews/[id]/reanalyze — 配下のセッションをまとめて再分析する。
 *
 * 主な用途は、AI へのプロンプトを変えた後に既存セッションを追随させること
 * （要約が英語で保存されていたものを日本語にし直す、など）。
 * セッションを1件ずつ開いて再分析する手間をなくすために用意した。
 */

/** 1リクエストで処理する件数の上限。多い場合は繰り返し実行してもらう。 */
const BATCH = 5
/** 実行時間の予算（ミリ秒）。超えたら打ち切り、残りは次回に回す。 */
const TIME_BUDGET_MS = 210_000

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params
    if (!(await rateLimit(`reanalyze:${orgId}:${getClientIp(req)}`, 5, 300))) {
      return NextResponse.json({ error: 'しばらく時間をおいてから再度お試しください' }, { status: 429 })
    }

    // 「英語のまま残っているものだけ」を対象にできるようにする（既定は全件）
    const onlyNonJapanese = req.nextUrl.searchParams.get('onlyNonJapanese') === '1'

    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: {
        questions: { orderBy: { order: 'asc' }, select: { text: true } },
        sessions: {
          // パイロットは分析対象外。文字起こしが無いものは再分析できない。
          where: { isPilot: false, transcript: { isNot: null } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            transcript: {
              select: {
                fullText: true,
                summary: true,
                segments: {
                  orderBy: { startTime: 'asc' },
                  select: { speaker: true, text: true, startTime: true, endTime: true },
                },
              },
            },
          },
        },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const questions = interview.questions.map((q) => q.text)

    // 日本語が1文字も含まれない要約は、日本語化前に分析されたものと判断する
    const looksJapanese = (t: string | null) =>
      !!t && /[぀-ヿ一-龯]/.test(t)

    const targets = interview.sessions.filter((s) => {
      if ((s.transcript?.segments.length ?? 0) === 0) return false
      if (!onlyNonJapanese) return true
      return !looksJapanese(s.transcript?.summary ?? null)
    })

    let done = 0
    let failed = 0
    let processed = 0
    const startedAt = Date.now()

    for (const session of targets.slice(0, BATCH)) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
      processed += 1
      try {
        await analyzeAndSaveSession({
          sessionId: session.id,
          transcriptText: session.transcript?.fullText ?? '',
          segments: (session.transcript?.segments ?? []).map((seg) => ({
            speaker: seg.speaker,
            text: seg.text,
            start: seg.startTime,
            end: seg.endTime,
          })),
          // 感情データは再分析の対象外（録画時に取得した実測値なので触らない）
          emotions: null,
          questions,
        })
        done += 1
      } catch (err) {
        console.error('reanalyze failed for session', session.id, err)
        failed += 1
      }
    }

    // 共通インサイトは要約から作るため、再分析したらキャッシュを捨てる
    if (done > 0) {
      await prisma.interview
        .update({ where: { id }, data: { commonInsights: null, insightsCount: null } })
        .catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      done,
      failed,
      remaining: Math.max(0, targets.length - processed),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
