import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { verifyToken, type TokenPayload } from './jwt'
import { prisma } from './db'
import { hasPermission, type Role } from './permissions'

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
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

/** 認証 + 権限チェック。指定ロール未満なら ForbiddenError を投げる */
export async function requireRole(minRole: Role): Promise<TokenPayload & { role: string }> {
  const payload = await requireAuth()
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId: payload.userId, organizationId: payload.orgId } },
    select: { role: true },
  })
  const role = member?.role ?? 'viewer'
  if (!hasPermission(role, minRole)) throw new ForbiddenError()
  return { ...payload, role }
}

/**
 * 被験者フロー（未認証）専用の限定スコープ認可。
 * セッション作成時に発行した participantToken と一致する場合のみ、
 * 当該セッションへの結果送信・status 更新を許可する。
 * 一致しなければ AuthError を投げる。
 */
export async function requireParticipantToken(sessionId: string, token: string | null): Promise<void> {
  if (!token) throw new AuthError()
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { participantToken: true },
  })
  if (!session?.participantToken) throw new AuthError()
  const expected = Buffer.from(session.participantToken)
  const actual = Buffer.from(token)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AuthError()
  }
}

/** API ルートの共通エラーハンドラー */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  console.error('[API Error]', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
