import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { createRoom } from '@/lib/daily'
import { randomBytes } from 'crypto'
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

    // roomName を知るだけで /interview/[roomName] から participantToken を取得できるため、
    // 列挙されないよう十分なエントロピー（96bit）を持たせる
    const roomName = `interview-${randomBytes(12).toString('hex')}`
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    let dailyRoomUrl = `${origin}/interview/${roomName}`

    if (process.env.DAILY_API_KEY) {
      try {
        const room = await createRoom(roomName)
        dailyRoomUrl = room.url
      } catch { /* Daily.co 未設定時はそのまま */ }
    }

    // 被験者フロー（未認証）が自分のセッションにのみ結果送信できるよう、
    // 高エントロピーの秘密トークンを発行する。被験者ページのサーバーコンポーネント経由でのみ渡す。
    const participantToken = randomBytes(32).toString('base64url')
    const session = await prisma.session.create({
      data: { interviewId, participantId: participant.id, dailyRoomName: roomName, dailyRoomUrl, participantToken },
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
