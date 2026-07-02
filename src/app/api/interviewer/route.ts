import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireParticipant, handleApiError } from '@/lib/api-auth'

// ビルド時のモジュール評価でエラーが出ないよう、呼び出し時に初期化する
function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export interface InterviewerDecision {
  action: 'follow_up' | 'next_question' | 'wrap_up'
  question?: string // action が follow_up の場合
  reason: string
}

export async function POST(req: NextRequest) {
  try {
  await requireParticipant(req)

  const body = await req.json()
  const {
    plannedQuestion,   // 現在の設定質問
    participantAnswer, // 被験者の回答
    followUpCount,     // これまでの深掘り回数（最大2回）
    conversationSoFar, // これまでの会話履歴
    interviewTopic,    // インタビューの目的
  } = body

  if (!participantAnswer?.trim()) {
    return NextResponse.json<InterviewerDecision>({
      action: 'next_question',
      reason: '回答なし',
    })
  }

  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content: `あなたはユーザーリサーチの専門家として、ユーザーインタビューを進行しています。
インタビューの目的: ${interviewTopic}

以下のルールに従って次のアクションを決定してください：
- 被験者の回答が曖昧・表面的 → "follow_up"（深掘り質問を生成）
- 十分な情報が得られた、または深掘り${followUpCount >= 2 ? '上限に達した' : 'は不要'} → "next_question"
- 全質問が終わった → "wrap_up"

深掘り質問のガイドライン：
- 「なぜそう感じましたか？」「具体的にどんな状況でしたか？」「その時どう対処しましたか？」
- 日本語で、短く、自然な口語で
- 誘導的にならないオープンクエスチョン

必ずJSONのみで返答: {"action":"follow_up"|"next_question"|"wrap_up","question":"(follow_upの場合のみ)","reason":"判断理由"}`,
      },
      {
        role: 'user',
        content: `【設定質問】${plannedQuestion}

【これまでの会話】
${conversationSoFar || 'なし'}

【今回の被験者の回答】
${participantAnswer}

【既に深掘りした回数】${followUpCount}回

次のアクションを決定してください。`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? '{}'
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return NextResponse.json<InterviewerDecision>({ action: 'next_question', reason: 'parse error' })
  }

  try {
    const decision = JSON.parse(jsonMatch[0]) as InterviewerDecision
    return NextResponse.json(decision)
  } catch {
    return NextResponse.json<InterviewerDecision>({ action: 'next_question', reason: 'parse error' })
  }
  } catch (err) {
    return handleApiError(err)
  }
}
