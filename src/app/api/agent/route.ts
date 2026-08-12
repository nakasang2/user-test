import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { chatWithAgent } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { sanitizeMessages } from '@/lib/llm-safety'
import { rateLimit } from '@/lib/ratelimit'
import {
  aggregateTasks, aggregateScores, overallSuccess, avgSessionDuration,
  hardestTask, calcNps, scoreDistribution, type SessionLike,
} from '@/lib/interview-aggregate'

export async function POST(req: NextRequest) {
  try {
  const { orgId } = await requireAuth()
  if (!(await rateLimit(`agent:${orgId}`, 30, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const body = await req.json()
  const { messages, sessionId, interviewId } = body

  let context = ''

  if (sessionId) {
    // IDOR 対策: 呼び出し元の組織が所有するセッションのみ参照可
    const session = await prisma.session.findFirst({
      where: { id: sessionId, interview: { organizationId: orgId } },
      include: {
        interview: { include: { questions: true, tasks: true } },
        participant: true,
        transcript: { include: { segments: true } },
        emotions: true,
        taskResults: { orderBy: { order: 'asc' } },
        answers: { orderBy: { order: 'asc' } },
        screenerAnswers: { orderBy: { order: 'asc' } },
      },
    })

    if (session) {
      context = buildSessionContext(session)
    }
  } else if (interviewId) {
    const interview = await prisma.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      include: {
        questions: true,
        tasks: true,
        screeners: true,
        sessions: {
          // パイロット（リサーチャーの試行）は知見ではないので AI の文脈に入れない
          where: { isPilot: false },
          include: {
            participant: true,
            transcript: { include: { segments: true } },
            emotions: true,
            taskResults: { orderBy: { order: 'asc' } },
            answers: { orderBy: { order: 'asc' } },
            screenerAnswers: { orderBy: { order: 'asc' } },
          },
        },
      },
    })

    if (interview) {
      context = buildInterviewContext(interview)
    }
  }

  const reply = await chatWithAgent(sanitizeMessages(messages), context)
  return NextResponse.json({ reply })
  } catch (err) {
    return handleApiError(err)
  }
}

type EmotionLike = {
  happy: number; sad: number; neutral: number
  surprised: number; angry: number; fearful: number; disgusted: number
}

type TaskResultLike = {
  taskId: string | null; order: number; text: string; outcome: string
  durationSec: number | null; seq: number | null
  usedHint: boolean; assistedStart: boolean; excludedAt: Date | null
}

type AnswerLike = {
  questionId: string | null; order: number; text: string; type: string
  valueNum: number | null; valueText: string | null; excludedAt: Date | null
}

type ScreenerAnswerLike = { label: string; value: string }

/** 除外設定（excludedAt）は集計ロジック（lib/interview-aggregate.ts）と型が違うだけで
 * 意味は同じ（null なら集計対象）。文字列化して SessionLike の形に合わせる。 */
function toAggInput(taskResults: TaskResultLike[], answers: AnswerLike[]): Pick<SessionLike, 'taskResults' | 'answers'> {
  return {
    taskResults: taskResults.map((t) => ({ ...t, excludedAt: t.excludedAt?.toISOString() ?? null })),
    answers: answers.map((a) => ({ ...a, excludedAt: a.excludedAt?.toISOString() ?? null })),
  }
}

function emotionSummary(emotions: EmotionLike[]): string {
  if (emotions.length === 0) return 'N/A'
  const keys = ['happy', 'surprised', 'neutral', 'sad', 'angry', 'fearful', 'disgusted'] as const
  const labels: Record<typeof keys[number], string> = {
    happy: 'Happy', surprised: 'Surprised', neutral: 'Neutral',
    sad: 'Sad', angry: 'Angry', fearful: 'Fearful', disgusted: 'Disgusted',
  }
  return keys
    .map((k) => `${labels[k]}: ${(avg(emotions.map((e) => e[k])) * 100).toFixed(0)}%`)
    .join(', ')
}

function buildSessionContext(session: {
  interview: {
    title: string
    objective: string | null
    type: string
    usabilityMode: string | null
    questions: { text: string; type: string }[]
    tasks: { text: string; order: number }[]
  }
  participant: { name: string } | null
  transcript: { fullText: string; summary: string | null; themes: string | null; segments: { speaker: string; text: string }[] } | null
  emotions: EmotionLike[]
  taskResults: TaskResultLike[]
  answers: AnswerLike[]
  screenerAnswers: ScreenerAnswerLike[]
  status: string
}) {
  const taskLines = session.taskResults.length > 0
    ? session.taskResults.map((t) => {
        const excluded = t.excludedAt ? ' [集計対象外]' : ''
        const parts = [`${t.order}. ${t.text}`, `outcome=${t.outcome}`]
        if (typeof t.durationSec === 'number') parts.push(`duration=${Math.round(t.durationSec)}s`)
        if (typeof t.seq === 'number') parts.push(`SEQ=${t.seq}`)
        if (t.usedHint) parts.push('used_hint')
        if (t.assistedStart) parts.push('assisted_start')
        return `- ${parts.join(', ')}${excluded}`
      }).join('\n')
    : 'なし'

  const answerLines = session.answers.length > 0
    ? session.answers.map((a) => {
        const excluded = a.excludedAt ? ' [集計対象外]' : ''
        const value = a.type === 'open' ? (a.valueText ?? '') : `${a.valueNum} (${a.type})`
        return `- Q${a.order}. ${a.text} → ${value}${excluded}`
      }).join('\n')
    : 'なし'

  const segmentLines = session.screenerAnswers.length > 0
    ? session.screenerAnswers.map((a) => `- ${a.label}: ${a.value}`).join('\n')
    : 'なし'

  return `
Interview: ${session.interview.title}
${session.interview.objective ? `Research objective (what we want to find out): ${session.interview.objective}\n` : ''}Type: ${session.interview.type}${session.interview.type === 'usability' ? ` (${session.interview.usabilityMode ?? ''})` : ''}
Participant: ${session.participant?.name ?? 'Anonymous'}
Status: ${session.status}

Questions:
${session.interview.questions.map((q, i) => `${i + 1}. [${q.type}] ${q.text}`).join('\n')}

${session.interview.tasks.length > 0 ? `Tasks:\n${session.interview.tasks.map((t) => `${t.order}. ${t.text}`).join('\n')}\n` : ''}
Task Results:
${taskLines}

Structured Answers:
${answerLines}

Segment/Screener Answers:
${segmentLines}

${session.transcript ? `
Transcript Summary: ${session.transcript.summary ?? 'N/A'}
Key Themes: ${session.transcript.themes ?? 'N/A'}

Full Transcript:
${session.transcript.segments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n')}
` : 'No transcript available yet.'}

Emotions (average): ${emotionSummary(session.emotions)}
`
}

/** 個別セッションの詳細を並べる件数の上限。文脈が肥大化して古い/後ろのセッションが
 * 黙って切り詰められるのを防ぐため、集計（Aggregate Summary）は必ず全セッション対象で
 * 別に計算し、ここで打ち切っても合計・平均などの数字は正確なまま保つ。 */
const MAX_SESSION_DETAILS = 30

function buildInterviewContext(interview: {
  title: string
  objective: string | null
  type: string
  usabilityMode: string | null
  questions: { text: string; type: string }[]
  tasks: { text: string; order: number }[]
  screeners: { label: string }[]
  sessions: {
    participant: { name: string } | null
    transcript: { summary: string | null; themes: string | null } | null
    emotions: EmotionLike[]
    taskResults: TaskResultLike[]
    answers: AnswerLike[]
    screenerAnswers: ScreenerAnswerLike[]
  }[]
}) {
  const sessionsForAgg: SessionLike[] = interview.sessions.map((s, i) => ({
    id: String(i),
    participantName: s.participant?.name ?? 'Anonymous',
    ...toAggInput(s.taskResults, s.answers),
  }))

  const taskAgg = aggregateTasks(sessionsForAgg)
  const scoreAgg = aggregateScores(sessionsForAgg)
  const overall = overallSuccess(taskAgg)
  const avgDur = avgSessionDuration(sessionsForAgg)
  const worst = hardestTask(taskAgg)

  const taskSummary = taskAgg.length > 0
    ? taskAgg.map((t) => {
        const rate = t.total > 0 ? `${Math.round((t.completed / t.total) * 100)}% (${t.completed}/${t.total})` : '試行なし'
        const extras = [
          t.notAttempted > 0 ? `未実施 ${t.notAttempted}` : null,
          t.hintUsed > 0 ? `ヒント使用 ${t.hintUsed}` : null,
          t.assistedStart > 0 ? `前提代行 ${t.assistedStart}` : null,
        ].filter(Boolean).join(', ')
        return `- ${t.text}: ${rate}${extras ? ` [${extras}]` : ''}`
      }).join('\n')
    : 'なし'

  const scoreSummary = scoreAgg.length > 0
    ? scoreAgg.map((s) => {
        const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length
        const headline = s.type === 'nps' ? `NPS ${calcNps(s.values)}（平均 ${mean.toFixed(1)}/10）` : `平均 ${mean.toFixed(1)}/5`
        const dist = scoreDistribution(s.values).map((d) => `${d.value}=${d.count}人`).join(', ')
        return `- ${s.text} (${s.type}): ${headline}, n=${s.values.length} [分布: ${dist}]`
      }).join('\n')
    : 'なし'

  // セグメント（事前質問）ごとの選択肢別人数
  const screenerCounts = new Map<string, Map<string, number>>()
  interview.sessions.forEach((s) => {
    s.screenerAnswers.forEach((a) => {
      const m = screenerCounts.get(a.label) ?? new Map<string, number>()
      m.set(a.value, (m.get(a.value) ?? 0) + 1)
      screenerCounts.set(a.label, m)
    })
  })
  const segmentSummary = screenerCounts.size > 0
    ? [...screenerCounts.entries()]
        .map(([label, m]) => `- ${label}: ${[...m.entries()].map(([v, c]) => `${v}=${c}人`).join(', ')}`)
        .join('\n')
    : 'なし'

  const shown = interview.sessions.slice(0, MAX_SESSION_DETAILS)
  const sessionDetails = shown.map((s, i) => `
Session ${i + 1} - ${s.participant?.name ?? 'Anonymous'}:
  Summary: ${s.transcript?.summary ?? 'Not processed'}
  Themes: ${s.transcript?.themes ?? 'N/A'}
  Emotions: ${emotionSummary(s.emotions)}
`).join('\n')

  const truncNote = interview.sessions.length > MAX_SESSION_DETAILS
    ? `\n（注: 個別セッションの詳細は最初の${MAX_SESSION_DETAILS}件のみ表示しています。全${interview.sessions.length}件を対象にした合計・平均は上の Aggregate Summary を参照してください）`
    : ''

  return `
Interview: ${interview.title}
${interview.objective ? `Research objective (what we want to find out): ${interview.objective}\n` : ''}Type: ${interview.type}${interview.type === 'usability' ? ` (${interview.usabilityMode ?? ''})` : ''}
Total Sessions: ${interview.sessions.length}

Questions:
${interview.questions.map((q, i) => `${i + 1}. [${q.type}] ${q.text}`).join('\n')}

${interview.tasks.length > 0 ? `Tasks:\n${interview.tasks.map((t) => `${t.order}. ${t.text}`).join('\n')}\n` : ''}
=== Aggregate Summary（除外設定を反映済み・全${interview.sessions.length}セッション対象） ===
${overall ? `Task success rate: ${overall.rate}% (${overall.completed}/${overall.total})、自力 ${overall.unaidedRate}%` : 'Task success rate: N/A'}
Task breakdown:
${taskSummary}
${worst ? `Hardest task: ${worst.text} (${worst.rate}%)` : ''}
${avgDur ? `Avg session duration: ${Math.round(avgDur.mean)}s (n=${avgDur.n})` : ''}

Score breakdown:
${scoreSummary}

Segment breakdown (screener answers):
${segmentSummary}

=== Per-Session Details ===${truncNote}
${sessionDetails}
`
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
