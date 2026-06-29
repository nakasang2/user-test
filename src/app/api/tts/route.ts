import { NextRequest, NextResponse } from 'next/server'
import { LIMITS } from '@/lib/llm-safety'
import { getOpenAI } from '@/lib/openai'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

/**
 * POST /api/tts
 * body: { text: string }
 * response: audio/mpeg (mp3)
 *
 * 使用モデル: tts-1（低遅延優先）
 * ボイス: nova（自然で温かみのある女性声、日本語に最適）
 * 他の選択肢: shimmer（穏やか）/ alloy（中性）/ onyx（低め男性）
 */
export async function POST(req: NextRequest) {
  // 未認証エンドポイント。OpenAI 課金の枯渇/DoS を防ぐため IP 単位でレート制限
  if (!(await rateLimit(`tts:${getClientIp(req)}`, 60, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const body = await req.json() as { text?: string }
  const text = body.text?.trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > LIMITS.ttsText) {
    return NextResponse.json({ error: 'text is too long' }, { status: 413 })
  }

  const client = getOpenAI()
  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: text,
    response_format: 'mp3',
    speed: 0.95,  // わずかにゆっくり（インタビュー向け）
  })

  const buffer = Buffer.from(await response.arrayBuffer())

  return new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
