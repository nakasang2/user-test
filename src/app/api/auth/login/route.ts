import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json() as { password?: string }
  const entered = body.password?.trim() ?? ''
  const correct = process.env.DASHBOARD_PASSWORD

  if (!correct) {
    // パスワード未設定時はそのまま通す（開発環境向け）
    return NextResponse.json({ ok: true })
  }

  if (entered !== correct) {
    return NextResponse.json({ error: 'パスワードが違います' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('auth', correct, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7日間
    path: '/',
  })
  return res
}
