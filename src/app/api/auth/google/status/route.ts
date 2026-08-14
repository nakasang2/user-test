import { NextResponse } from 'next/server'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { isGoogleOAuthConfigured } from '@/lib/google-auth'

/** GET /api/auth/google/status — 自分のGoogle連携状況（設定画面の表示用） */
export async function GET() {
  try {
    const { userId } = await requireAuth()
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleEmail: true, googleConnectedAt: true },
    })
    const configured = isGoogleOAuthConfigured()
    return NextResponse.json({
      configured,
      connected: !!user?.googleConnectedAt,
      email: user?.googleEmail ?? null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
