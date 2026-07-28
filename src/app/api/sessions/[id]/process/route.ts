import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { analyzeTranscript, classifyAnswerSentiments } from '@/lib/ai'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

// AI 呼び出しを2回行うため、既定の実行時間上限では足りないことがある
export const maxDuration = 300

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
 try {
  const { id } = await props.params
  if (!(await rateLimit(`process:${id}:${getClientIp(req)}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // 二経路認可: 被験者フローは participantToken、ダッシュボードの再分析は認証＋組織所有権
  const participantToken = req.headers.get('x-participant-token')
  if (participantToken) {
    await requireParticipantToken(id, participantToken)
  } else {
    const { orgId } = await requireAuth()
    const owned = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const { transcript: transcriptText, segments, emotions: emotionData } = body

  if (typeof transcriptText !== 'string' || !Array.isArray(segments)) {
    return NextResponse.json({ error: 'transcript and segments are required' }, { status: 400 })
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: { interview: { include: { questions: true } } },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.session.update({
    where: { id },
    data: { status: 'processing' },
  })

  const questions = session.interview.questions.map((q) => q.text)
  // 発言の時刻 [mm:ss] を含むトランスクリプトを組み立て、AI 要約が根拠を引用できるようにする
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  // 行番号 #i を付けて渡し、発言単位の sentiment を index で対応づけられるようにする
  const timestampedTranscript = (segments as { speaker: string; text: string; start: number }[])
    .map((s, i) => `#${i} [${fmt(s.start ?? 0)}] ${s.speaker}: ${s.text}`)
    .join('\n') || transcriptText
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
    where: { sessionId: id },
    create: { sessionId: id, fullText: transcriptText, summary, themes, sentiment, sentimentNote },
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
      data: (segments as { speaker: string; text: string; start: number; end: number }[]).map((seg, i) => ({
        transcriptId: transcript.id,
        speaker: seg.speaker,
        text: seg.text,
        startTime: seg.start,
        endTime: seg.end,
        sentiment: seg.speaker === 'Interviewer' || seg.speaker === 'System'
          ? null
          : (segmentSentiments[String(i)] ?? null),
      })),
    }),
  ])

  if (emotionData && emotionData.length > 0) {
    await prisma.emotionResult.deleteMany({ where: { sessionId: id } })
    await prisma.emotionResult.createMany({
      data: emotionData.map((e: Record<string, number>) => ({
        sessionId: id,
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
  await prisma.session.update({
    where: { id },
    data: { status: 'done' },
  })

  // 自由回答の肯定/否定を判定して保存する。
  // 文字起こしの分析とは別呼び出しなので、ここが失敗しても要約・テーマは残る。
  // 失敗時は既存の判定を保持する（classifyAnswerSentiments は失敗を投げる）。
  try {
    const openAnswers = await prisma.answer.findMany({
      where: { sessionId: id, type: 'open', NOT: { valueText: null } },
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

  return NextResponse.json({ transcript, ok: true })
 } catch (err) {
   return handleApiError(err)
 }
}
