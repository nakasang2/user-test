import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        sessions: {
          include: {
            participant: true,
            transcript: true,
            _count: { select: { emotions: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(interview)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const interview = await prisma.interview.findFirst({ where: { id, organizationId: orgId } })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.interview.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
