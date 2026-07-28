import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAuth, requireRole, handleApiError } from '@/lib/api-auth'

/**
 * セッションのハイライト（引用＋メモ＋タグ）。定性分析用。
 * リサーチャー（ダッシュボード認証）のみが読み書きできる。被験者フローからは触らせない。
 */

const createSchema = z.object({
  quote: z.string().min(1).max(4000),
  note: z.string().max(4000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  segmentId: z.string().optional(),
  startTime: z.number().finite().optional(),
})

/** セッションが認証ユーザーの組織のものか確認する */
async function assertOwned(sessionId: string, orgId: string) {
  const owned = await prisma.session.findFirst({
    where: { id: sessionId, interview: { organizationId: orgId } },
    select: { id: true },
  })
  return !!owned
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    if (!(await assertOwned(id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const highlights = await prisma.highlight.findMany({
      where: { sessionId: id },
      orderBy: { startTime: 'asc' },
    })
    return NextResponse.json({ highlights })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId, userId } = await requireRole('editor')   // 閲覧専用メンバーは作成不可
    const { id } = await props.params
    if (!(await assertOwned(id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const { quote, note, tags, segmentId, startTime } = parsed.data

    const highlight = await prisma.highlight.create({
      data: {
        sessionId: id,
        quote,
        note: note || null,
        // 表記ゆれと重複を防ぐため、前後空白を落として重複排除する
        tags: [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))],
        segmentId: segmentId || null,
        startTime: startTime ?? null,
        createdBy: userId ?? null,
      },
    })
    return NextResponse.json({ highlight }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
