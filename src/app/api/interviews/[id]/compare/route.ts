import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateCommonInsights } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
  const { orgId } = await requireAuth()
  const { id } = await props.params

  // 秘密フィールド（participantToken/shareToken/recordingUrl）と PII（participant.email）を
  // 露出しないよう、必要なフィールドのみ select で取得する。
  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      title: true,
      description: true,
      commonInsights: true,
      insightsCount: true,
      questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, order: true, type: true } },
      // 一覧表示のため全ステータスのセッションを返す（分析・レーダーは done のみで算出）
      sessions: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          participant: { select: { name: true } },
          transcript: { select: { summary: true, themes: true, _count: { select: { segments: true } } } },
          emotions: { select: { happy: true, neutral: true, sad: true, surprised: true } },
        },
      },
    },
  })

  if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // クライアントへ返す interview は機密を含まない最小フィールドのみ
  const safeInterview = {
    id: interview.id,
    title: interview.title,
    description: interview.description,
    questions: interview.questions,
  }

  if (interview.sessions.length === 0) {
    return NextResponse.json({ interview: safeInterview, sessions: [], commonInsights: null })
  }

  // 感情の平均を計算（感情データがあるセッションのみ）
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
      segmentCount: s.transcript?._count.segments ?? 0,
    }
  })

  // AI に共通インサイトを生成させる（分析済み=done のみが対象。done 件数が変わらなければキャッシュ）
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  const doneStats = sessionsWithStats.filter((s) => s.status === 'done' && s.summary)
  const doneCount = doneStats.length
  let commonInsights: string | null = interview.commonInsights
  if (doneCount >= 2 && (refresh || interview.commonInsights === null || interview.insightsCount !== doneCount)) {
    const allSummaries = doneStats
      .map((s, i) => `参加者${i + 1}（${s.participantName}）: ${s.summary}`)
      .join('\n')

    commonInsights = await generateCommonInsights(interview.title, allSummaries)
    // 生成成功時のみキャッシュを更新
    if (commonInsights !== null) {
      await prisma.interview.update({
        where: { id },
        data: { commonInsights, insightsCount: doneCount },
      })
    }
  }

  return NextResponse.json({ interview: safeInterview, sessions: sessionsWithStats, commonInsights })
  } catch (err) {
    return handleApiError(err)
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
