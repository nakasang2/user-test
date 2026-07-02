import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  verifyToken,
  verifyParticipantToken,
  type TokenPayload,
  type ParticipantTokenPayload,
} from './jwt'
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

/**
 * 保護された API ルートで認証済みユーザー情報を取得する。
 * Member レコードの実在も確認するため、組織から削除されたユーザーの
 * トークンは（有効期限内でも）即時失効する。
 */
export async function requireAuth(): Promise<TokenPayload & { role: string }> {
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value
  if (!token) throw new AuthError()
  const payload = await verifyToken(token)
  if (!payload) throw new AuthError()
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId: payload.userId, organizationId: payload.orgId } },
    select: { role: true },
  })
  if (!member) throw new AuthError()
  return { ...payload, role: member.role }
}

/**
 * 被験者向け API の認証。x-session-token ヘッダーの署名付きトークンを検証する。
 * sessionId を渡すと、トークンがそのセッション専用であることも検証する。
 */
export async function requireParticipant(
  req: NextRequest,
  sessionId?: string,
): Promise<ParticipantTokenPayload> {
  const token = req.headers.get('x-session-token')
  if (!token) throw new AuthError()
  const payload = await verifyParticipantToken(token)
  if (!payload) throw new AuthError()
  if (sessionId && payload.sessionId !== sessionId) throw new ForbiddenError()
  return payload
}

/** 認証 + 権限チェック。指定ロール未満なら ForbiddenError を投げる */
export async function requireRole(minRole: Role): Promise<TokenPayload & { role: string }> {
  const payload = await requireAuth()
  if (!hasPermission(payload.role, minRole)) throw new ForbiddenError()
  return payload
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
