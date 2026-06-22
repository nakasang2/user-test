import { SignJWT, jwtVerify } from 'jose'
import { getEnv } from './env'

export interface TokenPayload {
  userId: string
  orgId: string
  email: string
}

function getSecret() {
  return new TextEncoder().encode(getEnv().JWT_SECRET)
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
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
}
