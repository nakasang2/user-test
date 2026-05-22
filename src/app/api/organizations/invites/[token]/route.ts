import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/** DELETE /api/organizations/invites/[token] — 招待を無効化 (admin+) */
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> },
) {
  try {
    const { orgId } = await requireRole('admin')
    const { token } = await props.params

    const invite = await prisma.invite.findUnique({ where: { token } })
    if (!invite || invite.organizationId !== orgId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.invite.delete({ where: { token } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
