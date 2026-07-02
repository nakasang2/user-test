import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateCommonInsights } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
  const { orgId } = await requireAuth()
  const { id } = await props.params

  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
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

  // AI 共通インサイト：対象セッションの組み合わせが変わった時だけ再生成し、DB にキャッシュする
  // （以前は GET のたびに LLM を呼んでいたため、開くたびに数秒の待ちと課金が発生していた）
  let commonInsights: string | null = interview.commonInsights
  if (interview.sessions.length >= 2) {
    const sessionKey = interview.sessions.map((s) => s.id).sort().join(',')
    if (sessionKey !== interview.insightsSessionKey) {
      const allSummaries = sessionsWithStats
        .filter((s) => s.summary)
        .map((s, i) => `参加者${i + 1}（${s.participantName}）: ${s.summary}`)
        .join('\n')

      const generated = await generateCommonInsights(interview.title, allSummaries)
      if (generated) {
        commonInsights = generated
        await prisma.interview.update({
          where: { id },
          data: { commonInsights: generated, insightsSessionKey: sessionKey },
        })
      }
      // 生成失敗時（null）は既存キャッシュを表示し、次回の GET で再試行する
    }
  } else {
    commonInsights = null
  }

  return NextResponse.json({ interview, sessions: sessionsWithStats, commonInsights })
  } catch (err) {
    return handleApiError(err)
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
