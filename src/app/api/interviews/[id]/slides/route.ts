import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { getAuthorizedClientForUser } from '@/lib/google-auth'
import { createSlideDeck } from '@/lib/google-slides'
import { computeSlideStats, renderStatsText, buildSlideSections, type SlideSession } from '@/lib/slide-deck-data'
import { generateSlideSummary } from '@/lib/ai'

/** Google側でトークンが失効/取り消されたときのエラー形状（gaxios）を判定する */
function isInvalidGrantError(err: unknown): boolean {
  const data = (err as { response?: { data?: { error?: string } } } | undefined)?.response?.data
  if (data?.error === 'invalid_grant') return true
  return err instanceof Error && err.message.includes('invalid_grant')
}

/**
 * POST /api/interviews/[id]/slides — スライド資料を自動生成する（editor+）。
 * 生成先は呼び出した本人が接続済みのGoogleアカウントのDrive。
 * 押すたびに毎回新しいファイルを作る（前回分の上書き・追記はしない）。
 * 共有設定は自動で付与しない（作成者のみアクセス可のまま）。
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { userId, orgId } = await requireRole('editor')
    const { id } = await props.params
    const origin = req.nextUrl.origin

    // 相互に独立したチェックなので並行に行う
    const [interview, client] = await Promise.all([
      prisma.interview.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, title: true, objective: true },
      }),
      getAuthorizedClientForUser(userId, origin),
    ])
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!client) {
      return NextResponse.json({ error: 'google_not_connected' }, { status: 400 })
    }

    // 画面の「結果サマリー」と同じ母集団（パイロットを除く全セッション。分析未完了でも実測値は含む）。
    // ※感情の傾向だけは画面のレーダーチャートに合わせ computeSlideStats 内で done のみに絞る
    const [sessions, highlights] = await Promise.all([
      prisma.session.findMany({
        where: { interviewId: id, isPilot: false },
        select: {
          id: true,
          status: true,
          createdAt: true,
          participant: { select: { name: true } },
          taskResults: {
            orderBy: { order: 'asc' },
            select: { taskId: true, order: true, text: true, outcome: true, durationSec: true, seq: true, usedHint: true, assistedStart: true, excludedAt: true },
          },
          answers: {
            orderBy: { order: 'asc' },
            select: { questionId: true, order: true, text: true, type: true, valueNum: true, valueText: true, followUpCount: true, sentiment: true, excludedAt: true },
          },
          emotions: { select: { happy: true, neutral: true, sad: true, surprised: true } },
        },
      }),
      prisma.highlight.findMany({
        where: { session: { interviewId: id, isPilot: false } },
        select: { quote: true, note: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const slideSessions: SlideSession[] = sessions.map((s) => ({
      id: s.id,
      participantName: s.participant?.name ?? 'Anonymous',
      status: s.status,
      createdAt: s.createdAt,
      taskResults: s.taskResults.map((t) => ({ ...t, excludedAt: t.excludedAt?.toISOString() ?? null })),
      answers: s.answers.map((a) => ({ ...a, excludedAt: a.excludedAt?.toISOString() ?? null })),
      emotions: s.emotions,
    }))

    const stats = computeSlideStats(slideSessions)

    // 発言の要約だけでなく、成功率・スコア・感情などの実数値を踏まえた「事実・仮説・
    // 次のアクション」構成の総括をスライド用に生成する（画面の共通インサイトは発言の
    // 要約だけを見て書くため、ユーザビリティテストのように会話が薄い調査だと
    // 実測値と無関係な文章になってしまう問題があった）
    const qualitativeText = highlights
      .map((h) => (h.note ? `${h.quote}（${h.note}）` : h.quote))
      .join('\n')
    const summaryText = stats.participantCount > 0
      ? await generateSlideSummary({
          title: interview.title,
          objective: interview.objective,
          statsText: renderStatsText(stats),
          qualitativeText,
        })
      : null

    const sections = buildSlideSections(interview.title, stats, summaryText, highlights)

    try {
      const { url } = await createSlideDeck(client, interview.title, sections)
      return NextResponse.json({ url })
    } catch (err) {
      if (isInvalidGrantError(err)) {
        // 接続が失効している。DB側の記録も消し、次回は「未接続」として再接続を促す
        await prisma.user.update({
          where: { id: userId },
          data: { googleRefreshToken: null, googleEmail: null, googleConnectedAt: null },
        }).catch(() => {})
        return NextResponse.json({ error: 'google_not_connected' }, { status: 400 })
      }
      throw err
    }
  } catch (err) {
    return handleApiError(err)
  }
}
