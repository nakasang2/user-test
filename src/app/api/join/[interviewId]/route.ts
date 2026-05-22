import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { createRoom } from '@/lib/daily'
import { v4 as uuidv4 } from 'uuid'
import { handleApiError } from '@/lib/api-auth'

const joinSchema = z.object({
  name:  z.string().min(1, '名前を入力してください').max(100),
  email: z.string().email().optional().or(z.literal('')),
})

/** GET /api/join/[interviewId] — インタビュータイトルなど公開情報を返す（認証不要） */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  try {
    const { interviewId } = await props.params
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: { id: true, title: true, description: true },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(interview)
  } catch (err) {
    return handleApiError(err)
  }
}

/** POST /api/join/[interviewId] — 参加者登録＋セッション自動生成（認証不要） */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  try {
    const { interviewId } = await props.params
    const body = await req.json()
    const parsed = joinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { name, email } = parsed.data

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } })
    if (!interview) return NextResponse.json({ error: 'インタビューが見つかりません' }, { status: 404 })

    const participant = await prisma.participant.create({
      data: { name, email: email || null },
    })

    const roomName = `interview-${uuidv4().slice(0, 8)}`
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    let dailyRoomUrl = `${origin}/interview/${roomName}`

    if (process.env.DAILY_API_KEY) {
      try {
        const room = await createRoom(roomName)
        dailyRoomUrl = room.url
      } catch { /* Daily.co 未設定時はそのまま */ }
    }

    const session = await prisma.session.create({
      data: { interviewId, participantId: participant.id, dailyRoomName: roomName, dailyRoomUrl },
    })

    return NextResponse.json({
      sessionId: session.id,
      roomName,
      interviewUrl: `${origin}/interview/${roomName}`,
    }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
