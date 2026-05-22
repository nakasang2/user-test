import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { verifyToken, type TokenPayload } from './jwt'

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

/** 保護された API ルートで認証済みユーザー情報を取得する */
export async function requireAuth(): Promise<TokenPayload> {
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value
  if (!token) throw new AuthError()
  const payload = await verifyToken(token)
  if (!payload) throw new AuthError()
  return payload
}

/** API ルートの共通エラーハンドラー */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.error('[API Error]', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
