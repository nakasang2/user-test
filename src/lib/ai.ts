import { getOpenAI } from './openai'
import { LIMITS, clampText, wrapUntrusted, UNTRUSTED_DATA_GUARD } from './llm-safety'

export async function analyzeTranscript(
  transcript: string,
  questions: string[]
): Promise<{ summary: string; themes: string; sentiment: string }> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an expert UX researcher analyzing user interview transcripts.
The transcript lines are prefixed with [mm:ss] timestamps.
Provide structured analysis in JSON format with keys: summary, themes, sentiment.
- summary: 2-3 sentence overview of key findings. When you reference a specific finding, cite the supporting moment with its [mm:ss] timestamp so claims can be verified.
- themes: comma-separated list of main themes
- sentiment: overall sentiment (positive/neutral/negative) with brief explanation
${UNTRUSTED_DATA_GUARD}`,
      },
      {
        role: 'user',
        content: `Interview Questions:
${questions.map((q, i) => `${i + 1}. ${clampText(q, LIMITS.question)}`).join('\n')}

Transcript:
${wrapUntrusted(transcript, LIMITS.transcript)}

Analyze this interview and return a JSON object.`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  try {
    const parsed = JSON.parse(text)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : text,
      themes: typeof parsed.themes === 'string' ? parsed.themes : '',
      sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : 'neutral',
    }
  } catch {
    return { summary: text, themes: '', sentiment: 'neutral' }
  }
}

export async function chatWithAgent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: string
): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that helps analyze user interview data.
You have access to interview transcripts and analysis data.
Answer questions concisely and helpfully based on the provided data.
${UNTRUSTED_DATA_GUARD}

Interview Data Context:
${wrapUntrusted(context, LIMITS.context)}`,
      },
      ...messages,
    ],
  })

  return response.choices[0].message.content ?? ''
}

export async function generateInterviewQuestions(
  topic: string,
  count: number = 5
): Promise<string[]> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Generate ${count} open-ended user interview questions about: "${topic}"
Return ONLY a JSON array of strings. No explanation.`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? '[]'
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // ignore
    }
  }
  return []
}

// 複数セッションの共通インサイト生成（インタビュー比較ページ用）
export async function generateCommonInsights(
  interviewTitle: string,
  summaries: string
): Promise<string | null> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${UNTRUSTED_DATA_GUARD}
以下は「${clampText(interviewTitle, LIMITS.topic)}」に対する複数のユーザーインタビューの要約です。
全参加者に共通する課題・パターン・インサイトを3〜5点、箇条書きで簡潔にまとめてください。

${wrapUntrusted(summaries, LIMITS.context)}`,
        },
      ],
    })
    return response.choices[0].message.content ?? null
  } catch {
    return null
  }
}
