import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/**
 * POST /api/interviews/[id]/pilot — パイロット（リハーサル）セッションを作成する。
 *
 * リサーチャーが本番配布前に被験者フローを一通り試すための入口。
 * 従来は自分で参加リンクを開くしかなく、その試行が本物の結果として集計に混ざっていた。
 *
 * 認証必須にしているのは、被験者が自分のセッションをパイロットと自称して
 * 集計から抜けられる（＝データを消せる）状態を作らないため。
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId, userId } = await requireRole('editor')
    const { id } = await props.params

    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })

    const participant = await prisma.participant.create({
      data: { name: `【パイロット】${user?.name ?? '担当者'}` },
    })

    const roomName = `interview-${randomBytes(12).toString('hex')}`
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(_req.url).origin
    // 被験者が実際に開く URL（Daily のルームは使わない。上記 join と同じ理由）
    const dailyRoomUrl = `${origin}/interview/${roomName}`

    const participantToken = randomBytes(32).toString('base64url')
    await prisma.session.create({
      data: {
        interviewId: id,
        participantId: participant.id,
        dailyRoomName: roomName,
        dailyRoomUrl,
        participantToken,
        isPilot: true,
        // 本人の試行なので同意は取得済みとして扱う
        consentedAt: new Date(),
      },
    })

    return NextResponse.json({ roomName, url: `/interview/${roomName}` }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
