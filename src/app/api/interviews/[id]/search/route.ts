import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

/**
 * GET /api/interviews/[id]/search?q=... — インタビュー配下の全セッションを横断して発言を全文検索。
 *
 * 「価格について言及した人は誰か」を探すための機能。セッションを1件ずつ開いて
 * 目視で探す運用をなくすのが目的。結果は参加者ごとにまとめて返す。
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    // 全文検索は索引が効かず重いので、連打による負荷を抑える
    if (!(await rateLimit(`search:${orgId}:${getClientIp(req)}`, 60, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()

    if (q.length < 2) {
      return NextResponse.json({ query: q, results: [], tooShort: true })
    }

    // 組織所有のインタビューであることを確認（他組織のデータを検索させない）
    const owned = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // LIKE のワイルドカードを無効化する。エスケープしないと「10%」の検索が
    // 「%10%%」になり、% を含まない行まで一致してしまう（画面上は光らないのに件数だけ増える）。
    const escaped = q.replace(/[\\%_]/g, '\\$&')
    const where = {
      text: { contains: escaped, mode: 'insensitive' as const },
      transcript: { session: { interviewId: id } },
    }

    // 表示件数の上限。到達したら UI に「一部のみ表示」と伝えるため総数も取る。
    const TAKE = 500
    const totalHits = await prisma.transcriptSegment.count({ where })
    const segments = await prisma.transcriptSegment.findMany({
      where,
      select: {
        id: true,
        text: true,
        speaker: true,
        startTime: true,
        transcript: {
          select: {
            session: {
              select: { id: true, participant: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
      take: TAKE,
    })

    // 参加者（セッション）ごとにまとめる
    const bySession = new Map<string, {
      sessionId: string
      participantName: string
      hits: { id: string; text: string; speaker: string; startTime: number }[]
    }>()

    for (const seg of segments) {
      const session = seg.transcript.session
      const entry = bySession.get(session.id) ?? {
        sessionId: session.id,
        participantName: session.participant?.name ?? 'Anonymous',
        hits: [],
      }
      entry.hits.push({ id: seg.id, text: seg.text, speaker: seg.speaker, startTime: seg.startTime })
      bySession.set(session.id, entry)
    }

    const results = [...bySession.values()]
    return NextResponse.json({
      query: q,
      totalHits,
      sessionCount: results.length,
      // 上限に達した場合、表示に出ていない参加者がいる可能性を UI に伝える
      truncated: totalHits > segments.length,
      results,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
