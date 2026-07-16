import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { chatWithAgent } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { sanitizeMessages } from '@/lib/llm-safety'
import { rateLimit } from '@/lib/ratelimit'

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
        interview: { include: { questions: true } },
        participant: true,
        transcript: { include: { segments: true } },
        emotions: true,
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
        sessions: {
          include: {
            participant: true,
            transcript: { include: { segments: true } },
            emotions: true,
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

function buildSessionContext(session: {
  interview: { title: string; questions: { text: string }[] }
  participant: { name: string } | null
  transcript: { fullText: string; summary: string | null; themes: string | null; segments: { speaker: string; text: string }[] } | null
  emotions: { timestamp: number; happy: number; sad: number; neutral: number }[]
  status: string
}) {
  const emotionAvg = session.emotions.length > 0
    ? {
        happy: avg(session.emotions.map((e) => e.happy)),
        sad: avg(session.emotions.map((e) => e.sad)),
        neutral: avg(session.emotions.map((e) => e.neutral)),
      }
    : null

  return `
Interview: ${session.interview.title}
Participant: ${session.participant?.name ?? 'Anonymous'}
Status: ${session.status}

Questions:
${session.interview.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}

${session.transcript ? `
Transcript Summary: ${session.transcript.summary ?? 'N/A'}
Key Themes: ${session.transcript.themes ?? 'N/A'}

Full Transcript:
${session.transcript.segments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n')}
` : 'No transcript available yet.'}

${emotionAvg ? `
Average Emotions:
- Happy: ${(emotionAvg.happy * 100).toFixed(0)}%
- Sad: ${(emotionAvg.sad * 100).toFixed(0)}%
- Neutral: ${(emotionAvg.neutral * 100).toFixed(0)}%
` : ''}
`
}

function buildInterviewContext(interview: {
  title: string
  questions: { text: string }[]
  sessions: {
    participant: { name: string } | null
    transcript: { summary: string | null; themes: string | null } | null
    emotions: { happy: number; sad: number; neutral: number }[]
  }[]
}) {
  return `
Interview: ${interview.title}
Total Sessions: ${interview.sessions.length}

Questions:
${interview.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}

Sessions Overview:
${interview.sessions.map((s, i) => `
Session ${i + 1} - ${s.participant?.name ?? 'Anonymous'}:
  Summary: ${s.transcript?.summary ?? 'Not processed'}
  Themes: ${s.transcript?.themes ?? 'N/A'}
  Avg Happy: ${s.emotions.length > 0 ? (avg(s.emotions.map((e) => e.happy)) * 100).toFixed(0) + '%' : 'N/A'}
`).join('\n')}
`
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
