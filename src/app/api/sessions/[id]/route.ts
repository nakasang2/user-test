import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { del } from '@vercel/blob'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      interview: { include: { questions: { orderBy: { order: 'asc' } } } },
      participant: true,
      transcript: { include: { segments: true } },
      emotions: { orderBy: { timestamp: 'asc' } },
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(session)
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const body = await req.json()

  // 許可されたフィールドのみ更新（マスアサインメント攻撃対策）
  const allowed: Record<string, string | undefined> = {}
  if (typeof body.status === 'string') allowed.status = body.status
  if (typeof body.recordingId === 'string') allowed.recordingId = body.recordingId
  if (typeof body.recordingUrl === 'string') allowed.recordingUrl = body.recordingUrl

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const session = await prisma.session.update({
    where: { id },
    data: allowed,
    include: {
      interview: { include: { questions: { orderBy: { order: 'asc' } } } },
      participant: true,
    },
  })
  return NextResponse.json(session)
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const session = await prisma.session.findUnique({
    where: { id },
    select: { recordingUrl: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Vercel Blob の動画ファイルを削除（失敗してもDB削除は続行）
  if (session.recordingUrl) {
    try {
      await del(session.recordingUrl)
    } catch (e) {
      console.error('Blob deletion failed (continuing):', e)
    }
  }

  // DB 削除（transcript・segments・emotions は onDelete: Cascade で連鎖削除）
  await prisma.session.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
