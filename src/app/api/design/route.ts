import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { sanitizeMessages } from '@/lib/llm-safety'
import OpenAI from 'openai'

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

type Message = { role: 'user' | 'assistant'; content: string }

const CHAT_SYSTEM = `あなたはUXリサーチの専門家として、インタビュー設計を支援するAIアシスタントです。

研究者との対話を通じて、以下の3点を自然な会話で引き出してください：
1. このインタビューで何を知りたいのか（目的・課題）
2. 誰にインタビューするのか（対象ユーザー）
3. 具体的に検証したい仮説や疑問点

ルール：
- 一度に1つだけ質問してください
- 回答は150文字以内で簡潔に
- 共感を示しながら掘り下げてください
- 3〜4ターンで情報が揃ったら「プロットを生成できます。よろしいですか？」と提案してください
- それより前でも「生成する」ボタンが押されたら快く対応してください`

const GENERATE_SYSTEM = `あなたはUXリサーチの専門家です。
以下の会話履歴をもとに、インタビュープロットをJSON形式で生成してください。

出力形式（JSONのみ、説明文不要）：
{
  "title": "インタビュータイトル（20文字以内）",
  "description": "インタビューの目的・対象・背景（3文程度）",
  "questions": [
    { "text": "質問文", "type": "open" }
  ]
}

質問は5〜8問。オープンエンドな質問を基本とし、会話の流れで自然に出てきた具体的な疑問も含めてください。
必ずJSONのみ返してください。`

export async function POST(req: NextRequest) {
  try {
    await requireAuth()
    const body = await req.json()
    const { action } = body as { action?: 'generate' }
    const messages: Message[] = sanitizeMessages(body.messages)

    const client = getClient()

    if (action === 'generate') {
      // 会話履歴からインタビュープロットを生成
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: GENERATE_SYSTEM },
          ...messages,
          { role: 'user', content: 'この会話をもとにインタビュープロットをJSONで生成してください。' },
        ],
      })

      const text = res.choices[0].message.content ?? '{}'
      try {
        const interview = JSON.parse(text)
        return NextResponse.json({ interview })
      } catch {
        return NextResponse.json({ error: '生成結果のパースに失敗しました' }, { status: 500 })
      }
    }

    // 通常の会話
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 512,
      messages: [
        { role: 'system', content: CHAT_SYSTEM },
        ...messages,
      ],
    })

    const reply = res.choices[0].message.content ?? ''
    return NextResponse.json({ reply })
  } catch (err) {
    return handleApiError(err)
  }
}
