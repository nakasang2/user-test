import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const interview = await prisma.interview.findUnique({
    where: { id },
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
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  await prisma.interview.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
