import { NextRequest } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * レート制限。
 * - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が設定されていれば Upstash Redis を使用
 *   （Vercel Marketplace の Upstash 連携で環境変数が自動設定される。サーバーレス間で正しく共有される）。
 * - 未設定ならインメモリのスライディングウィンドウにフォールバック
 *   （単一インスタンス内のみ有効＝ベストエフォート。ローカル/未設定環境でも動作はする）。
 */

const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)

let redis: Redis | null = null
const upstashLimiters = new Map<string, Ratelimit>()

function getUpstashLimiter(limit: number, windowSec: number): Ratelimit {
  if (!redis) redis = Redis.fromEnv()
  const k = `${limit}:${windowSec}`
  let rl = upstashLimiters.get(k)
  if (!rl) {
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: 'uvt-rl',
    })
    upstashLimiters.set(k, rl)
  }
  return rl
}

// ── インメモリ・フォールバック ──
const memStore = new Map<string, number[]>()
function memLimit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now()
  const windowMs = windowSec * 1000
  const arr = (memStore.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) { memStore.set(key, arr); return false }
  arr.push(now)
  memStore.set(key, arr)
  // 簡易 GC（肥大化防止）
  if (memStore.size > 5000) {
    for (const [k, v] of memStore) {
      const live = v.filter((t) => now - t < windowMs)
      if (live.length === 0) memStore.delete(k); else memStore.set(k, live)
    }
  }
  return true
}

/** key に対してレート制限を判定する。許可なら true。失敗時（Upstash 障害等）は許可側に倒す。 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    if (hasUpstash) {
      const { success } = await getUpstashLimiter(limit, windowSec).limit(key)
      return success
    }
  } catch (e) {
    console.error('[ratelimit] Upstash error, allowing:', e)
    return true
  }
  return memLimit(key, limit, windowSec)
}

/** リクエストからクライアント IP を推定する */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
