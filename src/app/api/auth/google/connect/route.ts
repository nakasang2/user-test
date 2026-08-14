import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireAuth } from '@/lib/api-auth'
import { buildAuthUrl } from '@/lib/google-auth'

const SETTINGS_PATH = '/dashboard/settings/google'

/**
 * GET /api/auth/google/connect — Googleの同意画面へ遷移する。
 * ブラウザの通常ナビゲーション（<a href> や location.href）から呼ぶ想定なので、
 * 失敗時も JSON エラーではなく必ず redirect を返す（callback と同じ方針）
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin

  try {
    await requireAuth()
  } catch {
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?error=unauthorized`, origin))
  }

  const state = randomBytes(24).toString('base64url')
  const url = buildAuthUrl(origin, state)
  if (!url) {
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?error=not_configured`, origin))
  }
  const res = NextResponse.redirect(url)
  // callback 側で state を照合するための短命 cookie（CSRF対策）
  res.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })
  return res
}
