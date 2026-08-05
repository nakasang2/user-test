import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateCommonInsights } from '@/lib/ai'
import { requireAuth, getRole, handleApiError } from '@/lib/api-auth'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
  const { userId, orgId } = await requireAuth()
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
      type: true,
      seqEnabled: true,
      hintDelaySec: true,
      screeners: { orderBy: { order: 'asc' }, select: { id: true, label: true, options: true, disqualify: true, required: true, order: true } },
      // isPrerequisite を落とすと、編集モーダルが false で初期化して保存し、
      // 「次のタスクの前提」の設定が編集のたびに静かに消える
      tasks: { orderBy: { order: 'asc' }, select: { id: true, text: true, order: true, hint: true, isPrerequisite: true } },
      // 画像の3列を落とすと、編集モーダルが空で初期化して保存し、設定が静かに消える
      // （isPrerequisite で実際に起きた。LESSONS「データ設計」参照）
      questions: {
        orderBy: { order: 'asc' },
        select: { id: true, text: true, order: true, type: true, imageUrl: true, imageMode: true, imageDuration: true, followUpEnabled: true, followUpDepth: true, naturalCapture: true },
      },
      // 一覧表示のため全ステータスのセッションを返す（分析・レーダーは done のみで算出）
      sessions: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          isPilot: true,
          participant: { select: { name: true } },
          transcript: { select: { summary: true, themes: true, _count: { select: { segments: true } } } },
          emotions: { select: { happy: true, neutral: true, sad: true, surprised: true } },
          // 定量集計（タスク成功率・スコア平均）用
          taskResults: { orderBy: { order: 'asc' }, select: { taskId: true, order: true, text: true, outcome: true, durationSec: true, seq: true, excludedAt: true, usedHint: true, assistedStart: true } },
          // imageUrl を落とすと、回答比較テーブルのサムネイルが出なくなる
          answers: { orderBy: { order: 'asc' }, select: { questionId: true, order: true, text: true, imageUrl: true, type: true, valueNum: true, valueText: true, followUpCount: true, sentiment: true, excludedAt: true } },
          // 人が付けたタグの横断集計（アフィニティ分析）用
          highlights: { select: { tags: true } },
          screenerAnswers: { orderBy: { order: 'asc' }, select: { label: true, value: true, order: true } },
        },
      },
    },
  })

  if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // viewerRole は削除など破壊的な操作の出し分けにだけ使う（認可は各 API 側で行う）
  const viewerRole = await getRole(userId, orgId)

  // クライアントへ返す interview は機密を含まない最小フィールドのみ
  const safeInterview = {
    id: interview.id,
    title: interview.title,
    description: interview.description,
    type: interview.type,
    seqEnabled: interview.seqEnabled,
    hintDelaySec: interview.hintDelaySec,
    screeners: interview.screeners,
    questions: interview.questions,
    tasks: interview.tasks,
  }

  if (interview.sessions.length === 0) {
    return NextResponse.json({ interview: safeInterview, sessions: [], commonInsights: null, viewerRole })
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
      isPilot: s.isPilot,
      summary: s.transcript?.summary ?? null,
      themes: s.transcript?.themes ?? null,
      avgEmotion,
      dominantEmotion,
      segmentCount: s.transcript?._count.segments ?? 0,
      taskResults: s.taskResults,
      answers: s.answers,
      highlightTags: s.highlights.flatMap((h) => h.tags),
      screenerAnswers: s.screenerAnswers,
    }
  })

  // AI に共通インサイトを生成させる（分析済み=done のみが対象。done 件数が変わらなければキャッシュ）
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  // パイロット（リサーチャーの試行）は本番の知見ではないので分析対象から除く
  const doneStats = sessionsWithStats.filter((s) => s.status === 'done' && s.summary && !s.isPilot)
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

  return NextResponse.json({ interview: safeInterview, sessions: sessionsWithStats, commonInsights, viewerRole })
  } catch (err) {
    return handleApiError(err)
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
