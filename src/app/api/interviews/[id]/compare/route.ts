import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateCommonInsights } from '@/lib/ai'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const interview = await prisma.interview.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: 'asc' } },
      sessions: {
        where: { status: 'done' },
        include: {
          participant: true,
          transcript: { include: { segments: true } },
          emotions: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (interview.sessions.length === 0) {
    return NextResponse.json({ interview, sessions: [], commonInsights: null })
  }

  // 感情の平均を計算
  const sessionsWithStats = interview.sessions.map((s) => {
    const avgEmotion = s.emotions.length > 0
      ? {
          happy: avg(s.emotions.map((e) => e.happy)),
          neutral: avg(s.emotions.map((e) => e.neutral)),
          sad: avg(s.emotions.map((e) => e.sad)),
          surprised: avg(s.emotions.map((e) => e.surprised)),
        }
      : null

    const dominantEmotion = avgEmotion
      ? Object.entries(avgEmotion).sort(([, a], [, b]) => b - a)[0][0]
      : null

    return {
      id: s.id,
      participantName: s.participant?.name ?? 'Anonymous',
      status: s.status,
      createdAt: s.createdAt,
      summary: s.transcript?.summary ?? null,
      themes: s.transcript?.themes ?? null,
      avgEmotion,
      dominantEmotion,
      segmentCount: s.transcript?.segments.length ?? 0,
    }
  })

  // AI に共通インサイトを生成させる
  let commonInsights: string | null = null
  if (interview.sessions.length >= 2) {
    const allSummaries = sessionsWithStats
      .filter((s) => s.summary)
      .map((s, i) => `参加者${i + 1}（${s.participantName}）: ${s.summary}`)
      .join('\n')

    commonInsights = await generateCommonInsights(interview.title, allSummaries)
  }

  return NextResponse.json({ interview, sessions: sessionsWithStats, commonInsights })
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
