import { NextResponse } from 'next/server'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { decryptSecret } from '@/lib/token-crypto'

/** POST /api/auth/google/disconnect — 自分のGoogle連携を解除する */
export async function POST() {
  try {
    const { userId } = await requireAuth()
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } })

    // ベストエフォートで Google 側のトークンも失効させる。失敗しても DB 側の解除は続行する
    // （ここで止めると「解除したのに接続中のまま」に見える方が害が大きい）。
    // DB更新とは独立した操作なので並行に走らせる
    const revoke = user?.googleRefreshToken
      ? fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: decryptSecret(user.googleRefreshToken) }),
        }).catch((err) => {
          console.error('[google disconnect] revoke failed:', err instanceof Error ? err.message : 'unknown error')
        })
      : Promise.resolve()

    const clear = prisma.user.update({
      where: { id: userId },
      data: { googleRefreshToken: null, googleEmail: null, googleConnectedAt: null },
    })

    await Promise.all([revoke, clear])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
