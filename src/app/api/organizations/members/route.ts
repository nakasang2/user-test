import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/** GET /api/organizations/members — メンバー一覧 (admin+) */
export async function GET() {
  try {
    const { orgId } = await requireRole('admin')
    const members = await prisma.member.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(members)
  } catch (err) {
    return handleApiError(err)
  }
}
