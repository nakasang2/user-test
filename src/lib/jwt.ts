import { SignJWT, jwtVerify } from 'jose'

export interface TokenPayload {
  userId: string
  orgId: string
  email: string
}

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    // 被験者用トークンをダッシュボード認証に流用できないようにする
    if (payload.scope === 'participant') return null
    if (typeof payload.userId !== 'string' || typeof payload.orgId !== 'string') return null
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────
// 被験者（未ログイン）用のセッション限定トークン
// インタビュールームのサーバーコンポーネントで発行し、
// 被験者向け API は x-session-token ヘッダーでこれを要求する
// ─────────────────────────────────────────────

export interface ParticipantTokenPayload {
  sessionId: string
  scope: 'participant'
}

export async function signParticipantToken(sessionId: string): Promise<string> {
  return new SignJWT({ sessionId, scope: 'participant' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret())
}

export async function verifyParticipantToken(token: string): Promise<ParticipantTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (payload.scope !== 'participant' || typeof payload.sessionId !== 'string') return null
    return { sessionId: payload.sessionId, scope: 'participant' }
  } catch {
    return null
  }
}
