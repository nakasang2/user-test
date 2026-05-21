import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

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
  const body = await req.json() as { text?: string }
  const text = body.text?.trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })

  const client = getClient()
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
