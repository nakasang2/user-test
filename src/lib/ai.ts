import OpenAI from 'openai'

// ビルド時のモジュール評価でキーエラーが出ないよう、呼び出し時に初期化する
function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function analyzeTranscript(
  transcript: string,
  questions: string[]
): Promise<{ summary: string; themes: string; sentiment: string }> {
  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2048,
    messages: [
      {
        role: 'system',
        content: `You are an expert UX researcher analyzing user interview transcripts.
Provide structured analysis in JSON format with keys: summary, themes, sentiment.
- summary: 2-3 sentence overview of key findings
- themes: comma-separated list of main themes
- sentiment: overall sentiment (positive/neutral/negative) with brief explanation`,
      },
      {
        role: 'user',
        content: `Interview Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Transcript:
${transcript}

Analyze this interview and return JSON.`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // ignore
    }
  }
  return { summary: text, themes: '', sentiment: 'neutral' }
}

export async function chatWithAgent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: string
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that helps analyze user interview data.
You have access to interview transcripts and analysis data.
Answer questions concisely and helpfully based on the provided data.

Interview Data Context:
${context}`,
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
  const response = await getClient().chat.completions.create({
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
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `以下は「${interviewTitle}」に対する複数のユーザーインタビューの要約です。
全参加者に共通する課題・パターン・インサイトを3〜5点、箇条書きで簡潔にまとめてください。

${summaries}`,
        },
      ],
    })
    return response.choices[0].message.content ?? null
  } catch {
    return null
  }
}
