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

IMPORTANT: Write "summary", "themes", and "sentimentNote" in Japanese (日本語). The tool is used by Japanese researchers.
For "themes", separate the Japanese theme names with half-width commas ("," not "、") — the app splits on that character.
The "sentiment" and "s" values must stay as the English keywords positive/neutral/negative.
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

/**
 * 文字起こしから、質問ごとの参加者の回答を抽出する。
 *
 * 回答を構造化保存する仕組み（Answer テーブル）を入れる前に実施したセッションは、
 * 回答が文字起こしの中にしか無い。比較テーブルに載せるため後から取り出す用途。
 *
 * 深掘りのやり取りは元の質問の回答にまとめる（実施中の保存と同じ考え方）。
 * 返すのは 質問index -> { answer, followUpCount }。答えていない質問は含めない。
 */
export async function extractAnswersFromTranscript(
  questions: string[],
  transcript: string,
): Promise<Record<string, { answer: string; followUpCount: number }>> {
  if (questions.length === 0) return {}

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an expert UX researcher reconstructing structured answers from an interview transcript.

You are given a numbered list of planned questions and the full transcript.
The interviewer may have asked unplanned follow-up questions to dig deeper; those belong to the
planned question they followed. Merge the participant's replies to a planned question and its
follow-ups into ONE answer for that planned question.

Return JSON: {"results":[{"i":<question index, 0-based>,"answer":"<participant's words>","followUps":<number>}]}
- "answer": the participant's own words, quoted/condensed faithfully. Do NOT summarize into your own analysis. Keep it in the original language (Japanese).
- "followUps": how many unplanned follow-up questions the interviewer asked for this planned question (0 if none).
- Omit a question entirely if the participant never answered it.
- Do not invent content that is not in the transcript.
${UNTRUSTED_DATA_GUARD}`,
      },
      {
        role: 'user',
        content: `Planned questions:
${questions.map((q, i) => `#${i} ${clampText(q, LIMITS.question)}`).join('\n')}

Transcript:
${wrapUntrusted(transcript, LIMITS.transcript)}`,
      },
    ],
  })

  if (response.choices[0].finish_reason === 'length') {
    console.error('[extractAnswersFromTranscript] 出力が max_tokens で打ち切られました')
  }

  // パース失敗は「抽出結果ゼロ」と区別する（呼び出し側が既存データを消さないように）
  let parsed: unknown
  try {
    parsed = JSON.parse(response.choices[0].message.content ?? '')
  } catch {
    throw new Error('[extractAnswersFromTranscript] 応答が JSON として読めませんでした')
  }
  const arr = (parsed as { results?: unknown })?.results
  if (!Array.isArray(arr)) {
    throw new Error('[extractAnswersFromTranscript] 応答に results 配列がありません')
  }

  const out: Record<string, { answer: string; followUpCount: number }> = {}
  for (const item of arr.slice(0, questions.length * 2)) {
    const idx = typeof item?.i === 'number' ? item.i : Number(item?.i)
    const answer = typeof item?.answer === 'string' ? item.answer.trim() : ''
    if (!Number.isInteger(idx) || idx < 0 || idx >= questions.length || !answer) continue
    const fu = Number(item?.followUps)
    out[String(idx)] = {
      answer: clampText(answer, 4000),
      followUpCount: Number.isInteger(fu) && fu >= 0 && fu <= 50 ? fu : 0,
    }
  }
  return out
}

/**
 * 会話の中で自然に答えてもらった rating/nps 質問の発言から、厳密な数値を抽出する。
 *
 * 参加者は普段どおり自由に話しており、言い回しはバラバラ（「1です」「1だよ」等）。
 * ボタンでの回答（submitRating）と違って会話は止めない代わりに、後から数値だけを
 * 取り出して回答分布の集計に使う。抽出できない・曖昧な場合は無理に数値を作らず null を返す
 * （呼び出し側は文字起こしの引用（valueText）をそのまま残すので、null でも実害はない）。
 */
export async function extractStrictChoice(
  questionText: string,
  answerText: string,
  type: 'rating' | 'nps',
): Promise<number | null> {
  const min = type === 'nps' ? 0 : 1
  const max = type === 'nps' ? 10 : 5

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 128,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are extracting a strict numeric choice (integer ${min}-${max}) from a participant's free-form spoken answer to a question that expects one of these numbers.
Return JSON: {"value": <integer ${min}-${max}>} or {"value": null}
- Return the number the participant clearly chose, even if phrased casually (e.g. "1です", "1だよ", "うーん、1かな").
- If the answer does not clearly state one of the numbers ${min}-${max}, or is ambiguous, or mentions multiple numbers without a clear final choice, return {"value": null}. Do not guess.
${UNTRUSTED_DATA_GUARD}`,
      },
      {
        role: 'user',
        content: `Question: ${clampText(questionText, LIMITS.question)}
Participant's answer: ${wrapUntrusted(answerText, 2000)}`,
      },
    ],
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(response.choices[0].message.content ?? '')
  } catch {
    return null
  }
  const v = (parsed as { value?: unknown })?.value
  const n = typeof v === 'number' ? v : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null
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
  objective: string | null,
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
${objective ? `このテストで明らかにしたいことは次の通りです。これに答える形で、` : ''}全参加者に共通する課題・パターン・インサイトを3〜5点、箇条書きで簡潔にまとめてください。
${objective ? `\nテストの目的:\n${wrapUntrusted(clampText(objective, LIMITS.topic), LIMITS.topic)}\n` : ''}
${wrapUntrusted(summaries, LIMITS.context)}`,
        },
      ],
    })
    return response.choices[0].message.content ?? null
  } catch {
    return null
  }
}

/**
 * スライド資料の「サマリー」用に、定量データ（成功率・スコア・感情など）と
 * 定性データ（ハイライト）の両方を踏まえた総括を生成する。
 *
 * generateCommonInsights は発言の要約テキストだけを見て書くため、ユーザビリティ
 * テストのように会話が薄い調査では「データが少ない」というメタな感想しか書けず、
 * スライド上の数字（成功率・ヒント使用率など）と無関係な文章になっていた。
 * ここでは数字そのものを渡し、事実・仮説・次のアクションの3点に構造化させる。
 */
export async function generateSlideSummary(input: {
  title: string
  objective: string | null
  statsText: string
  qualitativeText: string
}): Promise<string | null> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${UNTRUSTED_DATA_GUARD}
以下は「${clampText(input.title, LIMITS.topic)}」というテストの結果です。
${input.objective ? `このテストで明らかにしたいことは次の通りです。これを踏まえて総括してください:\n${wrapUntrusted(clampText(input.objective, LIMITS.topic), LIMITS.topic)}\n` : ''}
社内向け資料に使う総括を、次の3つの見出しに分けて簡潔な箇条書き（見出しごとに1〜3点）で作成してください。
■事実（数字や傾向から読み取れること）
■仮説（なぜそうなったと考えられるか）
■次のアクション（改善の示唆や次に検証すべきこと）

データが少なく確度の低い推測になる場合は断定せず「〜の可能性がある」にとどめてください。参加者数が少ない場合はそれを踏まえた慎重な書き方にしてください。

定量データ:
${wrapUntrusted(input.statsText, LIMITS.context)}

参加者の発言・ハイライト:
${wrapUntrusted(input.qualitativeText || 'なし', LIMITS.context)}`,
        },
      ],
    })
    return response.choices[0].message.content ?? null
  } catch {
    return null
  }
}
