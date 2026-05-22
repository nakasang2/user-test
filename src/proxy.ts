import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/jwt'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /dashboard/* のみ保護。/interview/* /join/* /register などは公開
  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next()
  }

  const token = request.cookies.get('token')?.value
  if (!token) {
    return NextResponse.redirect(new URL(`/login?from=${encodeURIComponent(pathname)}`, request.url))
  }

  const payload = await verifyToken(token)
  if (!payload) {
    // 不正・期限切れトークン → クッキー削除してログインへ
    const res = NextResponse.redirect(new URL(`/login?from=${encodeURIComponent(pathname)}`, request.url))
    res.cookies.delete('token')
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
