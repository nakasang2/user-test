import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const sessions = await prisma.session.findMany({
      where: { interview: { organizationId: orgId } },
      include: {
        interview: { select: { id: true, title: true } },
        participant: true,
        transcript: { select: { id: true, summary: true } },
        _count: { select: { emotions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(sessions)
  } catch (err) {
    return handleApiError(err)
  }
}
