import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createRoom } from '@/lib/daily'
import { v4 as uuidv4 } from 'uuid'

/** GET /api/join/[interviewId] — インタビュータイトルなど公開情報を返す（認証不要） */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  const { interviewId } = await props.params
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, title: true, description: true },
  })
  if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(interview)
}

/** POST /api/join/[interviewId] — 参加者登録＋セッション自動生成（認証不要） */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  const { interviewId } = await props.params
  const body = await req.json() as { name?: string; email?: string }
  const name = body.name?.trim()

  if (!name) return NextResponse.json({ error: '名前を入力してください' }, { status: 400 })

  const interview = await prisma.interview.findUnique({ where: { id: interviewId } })
  if (!interview) return NextResponse.json({ error: 'インタビューが見つかりません' }, { status: 404 })

  // 参加者を作成
  const participant = await prisma.participant.create({
    data: { name, email: body.email?.trim() || null },
  })

  // ルーム生成
  const roomName = `interview-${uuidv4().slice(0, 8)}`
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  let dailyRoomUrl = `${origin}/interview/${roomName}`

  if (process.env.DAILY_API_KEY) {
    try {
      const room = await createRoom(roomName)
      dailyRoomUrl = room.url
    } catch {
      // Daily.co 未設定時はそのまま
    }
  }

  // セッションを作成
  const session = await prisma.session.create({
    data: {
      interviewId,
      participantId: participant.id,
      dailyRoomName: roomName,
      dailyRoomUrl,
    },
  })

  return NextResponse.json({
    sessionId: session.id,
    roomName,
    interviewUrl: `${origin}/interview/${roomName}`,
  }, { status: 201 })
}
