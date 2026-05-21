import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /dashboard/* のみ保護。/interview/* と API は公開のまま
  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next()
  }

  const password = process.env.DASHBOARD_PASSWORD
  // DASHBOARD_PASSWORD が未設定の場合は開発環境とみなしてスルー
  if (!password) return NextResponse.next()

  const authCookie = request.cookies.get('auth')
  if (authCookie?.value === password) {
    return NextResponse.next()
  }

  // 認証失敗 → ログインページへ（戻り先を from クエリに保存）
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
