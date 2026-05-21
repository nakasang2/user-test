import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createRoom } from '@/lib/daily'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  const sessions = await prisma.session.findMany({
    include: {
      interview: { select: { title: true } },
      participant: true,
      transcript: { select: { id: true, summary: true } },
      _count: { select: { emotions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { interviewId, participantName, participantEmail } = body

  const roomName = `interview-${uuidv4().slice(0, 8)}`
  let roomUrl = `${process.env.NEXT_PUBLIC_APP_URL}/interview/${roomName}`
  let dailyRoomUrl = roomUrl

  if (process.env.DAILY_API_KEY) {
    try {
      const room = await createRoom(roomName)
      dailyRoomUrl = room.url
    } catch {
      // Use built-in room if Daily.co is not configured
    }
  }

  let participantId: string | undefined

  if (participantName) {
    const participant = await prisma.participant.create({
      data: { name: participantName, email: participantEmail },
    })
    participantId = participant.id
  }

  const session = await prisma.session.create({
    data: {
      interviewId,
      participantId,
      dailyRoomName: roomName,
      dailyRoomUrl,
    },
    include: {
      interview: { include: { questions: { orderBy: { order: 'asc' } } } },
      participant: true,
    },
  })

  return NextResponse.json({
    ...session,
    joinUrl: `${process.env.NEXT_PUBLIC_APP_URL}/interview/${roomName}`,
  }, { status: 201 })
}
