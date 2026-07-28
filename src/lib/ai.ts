import { getOpenAI } from './openai'
import { LIMITS, clampText, wrapUntrusted, UNTRUSTED_DATA_GUARD } from './llm-safety'

// 正規化はクライアント（表示）とも共通の実装を使う（判定のズレを防ぐため）
import { normalizeSentiment } from './sentiment'
export { normalizeSentiment }

export async function analyzeTranscript(
  transcript: string,
  questions: string[]
): Promise<{
  summary: string
  themes: string
  sentiment: string | null
  sentimentNote: string
  segmentSentiments: Record<string, 'positive' | 'neutral' | 'negative'>
}> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    // 発言単位の判定を配列で返させるため、発言数に比例して出力が伸びる。
    // 途中で切れると JSON が壊れて要約ごと失われるため十分な余裕を取る。
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an expert UX researcher analyzing user interview transcripts.
Each transcript line is prefixed with "#<index> [mm:ss] <speaker>:".
Provide structured analysis in JSON format with keys: summary, themes, sentiment, sentimentNote, segmentSentiments.
- summary: 2-3 sentence overview of key findings. When you reference a specific finding, cite the supporting moment with its [mm:ss] timestamp so claims can be verified.
- themes: comma-separated list of main themes
- sentiment: the overall sentiment of the interview. Exactly one of: "positive", "neutral", "negative". No other text.
- sentimentNote: one short sentence explaining the overall sentiment.
- segmentSentiments: an array judging EACH participant line individually, as objects {"i": <the #index of that line>, "s": "positive"|"neutral"|"negative"}.
  Judge only lines spoken by the participant — skip interviewer/AI lines and System lines.
  Base each judgement on that line alone, not on the overall tone. Most factual statements are "neutral";
  reserve "negative" for frustration, confusion, or complaints, and "positive" for satisfaction or delight.
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
  // 出力が上限で打ち切られると JSON が壊れて要約まで失われる。原因を追えるようログに残す。
  if (response.choices[0].finish_reason === 'length') {
    console.error('[analyzeTranscript] 出力が max_tokens で打ち切られました（発言数が多すぎる可能性）')
  }
  const fallback = {
    summary: '分析結果を取得できませんでした。',
    themes: '',
    // 失敗時に 'neutral' を入れると「判定できた」ように見えてしまうため null にする
    sentiment: null as string | null,
    sentimentNote: '',
    segmentSentiments: {} as Record<string, 'positive' | 'neutral' | 'negative'>,
  }
  try {
    const parsed = JSON.parse(text)

    // 発言単位の判定を index -> sentiment のマップに変換。
    // 判定できなかった行は「不明」として残す（全体値で埋めない＝実態のない値を作らない）。
    const segmentSentiments: Record<string, 'positive' | 'neutral' | 'negative'> = {}
    const rawSegments = parsed.segmentSentiments
    if (Array.isArray(rawSegments)) {
      for (const item of rawSegments.slice(0, 2000)) {
        const idx = typeof item?.i === 'number' ? item.i : Number(item?.i)
        const s = normalizeSentiment(item?.s)
        if (Number.isInteger(idx) && idx >= 0 && s) segmentSentiments[String(idx)] = s
      }
    }

    return {
      // 型不一致時はモデル生出力をそのまま保存せず、固定の失敗メッセージにフォールバック
      summary: typeof parsed.summary === 'string' ? clampText(parsed.summary, 4000) : fallback.summary,
      themes: typeof parsed.themes === 'string' ? clampText(parsed.themes, 1000) : '',
      sentiment: normalizeSentiment(parsed.sentiment),
      sentimentNote: typeof parsed.sentimentNote === 'string' ? clampText(parsed.sentimentNote, 500) : '',
      segmentSentiments,
    }
  } catch {
    return fallback
  }
}

/**
 * 自由回答ごとに、評価対象への肯定/否定を判定する。
 *
 * 文字起こし全体の分析とは別呼び出しにしている。出力が回答数に比例するので
 * 同じ呼び出しに混ぜると上限超過で要約まで壊れるリスクがあるため（過去に発生）。
 * ここが失敗しても判定が付かないだけで、他の分析は無傷。
 *
 * 返すのは入力 index → 判定 のマップ。範囲外の index は捨てる。
 */
export async function classifyAnswerSentiments(
  items: { question: string; answer: string }[]
): Promise<Record<string, 'positive' | 'neutral' | 'negative'>> {
  if (items.length === 0) return {}

  // 1リクエストで判定する上限。検証の境界もこの件数に揃える（送っていない index を弾くため）
  const MAX_ITEMS = 100
  const sent = items.slice(0, MAX_ITEMS)
  const listed = sent
    .map((it, i) => `#${i}\nQ: ${clampText(it.question, LIMITS.question)}\nA: ${clampText(it.answer, 2000)}`)
    .join('\n\n')

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    // 整形 JSON では1件あたり 20 トークン強かかる。上限の 100 件でも切れないよう余裕を取る。
    // 途中で切れると JSON が壊れ、判定が丸ごと失われるため。
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an expert UX researcher classifying interview answers.
For EACH answer, judge the participant's stance toward the product or experience being discussed
— not their general mood. Return JSON: {"results": [{"i": <index>, "s": "positive"|"neutral"|"negative"}]}
- "positive": satisfied, found it easy, praised something
- "negative": frustrated, confused, complained, found it hard
- "neutral": factual or descriptive with no clear evaluation
If an answer contains both praise and complaint, judge by which one dominates the participant's overall stance.
Return exactly one entry per input index. No other keys, no explanations.
${UNTRUSTED_DATA_GUARD}`,
      },
      { role: 'user', content: wrapUntrusted(listed, LIMITS.transcript) },
    ],
  })

  if (response.choices[0].finish_reason === 'length') {
    console.error('[classifyAnswerSentiments] 出力が max_tokens で打ち切られました')
  }

  // パース失敗を「判定なし」と同一視すると、呼び出し側が既存の判定を
  // すべて null で上書きしてしまう。失敗は失敗として投げ、呼び出し側に保持させる。
  let parsed: unknown
  try {
    parsed = JSON.parse(response.choices[0].message.content ?? '')
  } catch {
    throw new Error('[classifyAnswerSentiments] 応答が JSON として読めませんでした')
  }
  const arr = (parsed as { results?: unknown })?.results
  if (!Array.isArray(arr)) {
    throw new Error('[classifyAnswerSentiments] 応答に results 配列がありません')
  }

  const out: Record<string, 'positive' | 'neutral' | 'negative'> = {}
  for (const item of arr.slice(0, MAX_ITEMS * 2)) {
    const idx = typeof item?.i === 'number' ? item.i : Number(item?.i)
    const s = normalizeSentiment(item?.s)
    // AI が返した添字は信用せず、実際に送った範囲内かを検証する
    if (Number.isInteger(idx) && idx >= 0 && idx < sent.length && s) {
      out[String(idx)] = s
    }
  }
  return out
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
        content: `${UNTRUSTED_DATA_GUARD}
Generate ${count} open-ended user interview questions about the following topic.
Topic: ${wrapUntrusted(topic, LIMITS.topic)}
Return ONLY a JSON array of strings. No explanation.`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? '[]'
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0])
      // 文字列要素のみ採用し、長さも制限する
      if (Array.isArray(arr)) {
        return arr.filter((q): q is string => typeof q === 'string').map((q) => clampText(q, LIMITS.question))
      }
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
