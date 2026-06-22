import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'

/**
 * POST /api/sessions/[id]/share — 読み取り専用の共有リンク用トークンを発行（既存なら再利用）。
 * 認証＋組織所有権を要求する。
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true, shareToken: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const shareToken = session.shareToken ?? randomBytes(24).toString('base64url')
    if (!session.shareToken) {
      await prisma.session.update({ where: { id }, data: { shareToken } })
    }
    return NextResponse.json({ shareToken })
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
    await prisma.session.update({ where: { id }, data: { shareToken: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
