import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireParticipant, handleApiError } from '@/lib/api-auth'

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

// TTS で読み上げる質問文の想定上限。API キー課金の踏み台化を防ぐ
const MAX_TTS_LENGTH = 1_000

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
  try {
    await requireParticipant(req)

    const body = await req.json() as { text?: string }
    const text = body.text?.trim()
    if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
    if (text.length > MAX_TTS_LENGTH) {
      return NextResponse.json({ error: 'text is too long' }, { status: 400 })
    }

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
  } catch (err) {
    return handleApiError(err)
  }
}
