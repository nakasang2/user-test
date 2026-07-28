import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'

/**
 * POST /api/sessions/[id]/share — 読み取り専用の共有リンク用トークンを発行（既存なら再利用）。
 * 認証＋組織所有権を要求する。
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true, shareToken: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 有効期限（日数）。被験者の発言が無期限に公開され続けるのを避けるため既定は 30 日。
    // 0 を明示した場合のみ無期限にする。
    const body = await req.json().catch(() => ({}))
    const rawDays = (body as { expiresInDays?: unknown })?.expiresInDays
    const days = typeof rawDays === 'number' && Number.isFinite(rawDays) ? Math.trunc(rawDays) : 30
    const shareExpiresAt = days > 0
      ? new Date(Date.now() + Math.min(days, 365) * 24 * 60 * 60 * 1000)
      : null

    const shareToken = session.shareToken ?? randomBytes(24).toString('base64url')
    // 再発行時も期限を更新する（「延長したい」が自然な操作のため）
    await prisma.session.update({ where: { id }, data: { shareToken, shareExpiresAt } })
    return NextResponse.json({ shareToken, shareExpiresAt })
  } catch (err) {
    return handleApiError(err)
  }
}

/** DELETE /api/sessions/[id]/share — 共有リンクを無効化する */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.session.update({ where: { id }, data: { shareToken: null, shareExpiresAt: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
