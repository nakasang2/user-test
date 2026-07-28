import { prisma } from './db'
import { analyzeTranscript, classifyAnswerSentiments } from './ai'

/**
 * セッション1件のAI分析と保存。
 *
 * 被験者フロー終了時（/api/sessions/[id]/process）と、
 * インタビュー単位の一括再分析（/api/interviews/[id]/reanalyze）の両方から呼ぶ。
 * 片方だけ挙動が変わる事故を避けるため、処理はここに集約する。
 */

export interface SegmentInput {
  speaker: string
  text: string
  start: number
  end?: number
}

export interface EmotionInput {
  timestamp: number
  happy?: number
  sad?: number
  angry?: number
  fearful?: number
  disgusted?: number
  surprised?: number
  neutral?: number
}

const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

export async function analyzeAndSaveSession(params: {
  sessionId: string
  transcriptText: string
  segments: SegmentInput[]
  /** 渡したときだけ感情データを置き換える。null/undefined なら既存を保持 */
  emotions?: EmotionInput[] | null
  questions: string[]
}) {
  const { sessionId, transcriptText, segments, emotions, questions } = params

  await prisma.session.update({ where: { id: sessionId }, data: { status: 'processing' } })

  // 行番号 #i と時刻 [mm:ss] を付けて渡す。
  // #i は発言単位 sentiment の対応づけ、[mm:ss] は要約が根拠を引用するために使う。
  const timestampedTranscript =
    segments.map((s, i) => `#${i} [${fmt(s.start ?? 0)}] ${s.speaker}: ${s.text}`).join('\n') ||
    transcriptText

  let summary = ''
  let themes = ''
  let sentiment: string | null = null
  let sentimentNote = ''
  let segmentSentiments: Record<string, string> = {}
  try {
    const result = await analyzeTranscript(timestampedTranscript, questions)
    summary = result.summary
    themes = result.themes
    sentiment = result.sentiment
    sentimentNote = result.sentimentNote
    segmentSentiments = result.segmentSentiments
  } catch (err) {
    console.error('analyzeTranscript failed:', err)
    summary = '分析に失敗しました。'
  }

  // インクリメンタル保存で既にトランスクリプトが存在し得るため、upsert 後に
  // セグメントを常に「全置換」して最終結果（sentiment 付き）を確実に反映する。
  const transcript = await prisma.transcript.upsert({
    where: { sessionId },
    create: { sessionId, fullText: transcriptText, summary, themes, sentiment, sentimentNote },
    update: { fullText: transcriptText, summary, themes, sentiment, sentimentNote },
  })
  await prisma.$transaction([
    prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
    prisma.transcriptSegment.createMany({
      // sentiment は AI が「その発言だけ」を見て判定した結果のみを入れる。
      // 判定が無い行は null のままにし、全体の値をコピーして埋めない（実態のない判定を作らない）。
      // AI インタビュアーとタスク記録には付けない: モデルが index をずらして返しても
      // それらに感情バッジが出る事故を防ぐ。逆に Whisper 再文字起こし後は話者が
      // 'Unknown'（話者分離なし）になるため、許可リストではなく除外リストで判定する。
      data: segments.map((seg, i) => ({
        transcriptId: transcript.id,
        speaker: seg.speaker,
        text: seg.text,
        startTime: seg.start,
        endTime: seg.end ?? seg.start,
        sentiment:
          seg.speaker === 'Interviewer' || seg.speaker === 'System'
            ? null
            : (segmentSentiments[String(i)] ?? null),
      })),
    }),
  ])

  if (emotions && emotions.length > 0) {
    await prisma.emotionResult.deleteMany({ where: { sessionId } })
    await prisma.emotionResult.createMany({
      data: emotions.map((e) => ({
        sessionId,
        timestamp: e.timestamp,
        happy: e.happy ?? 0,
        sad: e.sad ?? 0,
        angry: e.angry ?? 0,
        fearful: e.fearful ?? 0,
        disgusted: e.disgusted ?? 0,
        surprised: e.surprised ?? 0,
        neutral: e.neutral ?? 0,
      })),
    })
  }

  // 先に分析済みにしておく。この後の自由回答判定は補助的な処理なので、
  // ここで落ちても status が 'processing' のまま固まらないようにする
  //（固まると画面から「AI 再分析」ボタンが出ず復旧できなくなる）。
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'done' } })

  // 自由回答の肯定/否定を判定して保存する。
  // 文字起こしの分析とは別呼び出しなので、ここが失敗しても要約・テーマは残る。
  // 失敗時は既存の判定を保持する（classifyAnswerSentiments は失敗を投げる）。
  try {
    const openAnswers = await prisma.answer.findMany({
      where: { sessionId, type: 'open', NOT: { valueText: null } },
      select: { id: true, text: true, valueText: true },
      orderBy: { order: 'asc' },
    })
    if (openAnswers.length > 0) {
      const judged = await classifyAnswerSentiments(
        openAnswers.map((a) => ({ question: a.text, answer: a.valueText ?? '' })),
      )
      await prisma.$transaction(
        openAnswers.map((a, i) =>
          prisma.answer.update({
            where: { id: a.id },
            // 判定が返らなかったものは null に戻す（前回の古い判定を残さない）
            data: { sentiment: judged[String(i)] ?? null },
          }),
        ),
      )
    }
  } catch (err) {
    console.error('classifyAnswerSentiments failed:', err)
  }

  return transcript
}
