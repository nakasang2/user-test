import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { requireAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { exchangeCodeForTokens } from '@/lib/google-auth'

const SETTINGS_PATH = '/dashboard/settings/google'

/** 設定画面へ戻すリダイレクトを組み立て、CSRF用の state cookie を必ず消す */
function redirectToSettings(origin: string, query: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? origin).replace(/\/+$/, '')
  const res = NextResponse.redirect(new URL(`${SETTINGS_PATH}${query}`, base))
  res.cookies.delete('google_oauth_state')
  return res
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin

  // 未ログイン（Cookie切れ等）ならエラー表示に飛ばす。JSON 401 を出しても
  // ブラウザナビゲーションでは何も伝わらないため
  let userId: string
  try {
    ;({ userId } = await requireAuth())
  } catch {
    return redirectToSettings(origin, '?error=unauthorized')
  }

  const error = req.nextUrl.searchParams.get('error')
  if (error) {
    // ユーザーが同意画面でキャンセルした場合など
    return redirectToSettings(origin, '?error=denied')
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const expectedState = req.cookies.get('google_oauth_state')?.value

  // CSRF対策のstate照合。timingSafeEqual は同じ長さのバッファしか比較できないため、
  // 長さが違う時点で先に弾く（requireParticipantToken と同じ考え方）
  const stateOk =
    !!code && !!state && !!expectedState &&
    state.length === expectedState.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))

  if (!stateOk) {
    return redirectToSettings(origin, '?error=invalid_state')
  }

  try {
    const { encryptedRefreshToken, email } = await exchangeCodeForTokens(origin, code!)
    await prisma.user.update({
      where: { id: userId },
      data: { googleRefreshToken: encryptedRefreshToken, googleEmail: email, googleConnectedAt: new Date() },
    })
    return redirectToSettings(origin, '?connected=1')
  } catch (err) {
    // Google のトークン交換が失敗すると、投げられる GaxiosError は
    // client_secret を含むリクエスト内容を .config に保持していることがある。
    // err をそのまま console.error に渡すとログに漏れうるため、メッセージだけ残す
    console.error('[google callback]', err instanceof Error ? err.message : 'unknown error')
    return redirectToSettings(origin, '?error=exchange_failed')
  }
}
