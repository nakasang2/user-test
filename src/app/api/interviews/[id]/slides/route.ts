import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { getAuthorizedClientForUser } from '@/lib/google-auth'
import { createSlideDeck } from '@/lib/google-slides'
import { computeSlideStats, renderStatsText, buildSlideSections, type SlideSession } from '@/lib/slide-deck-data'
import { generateSlideSummary } from '@/lib/ai'
import { renderSection, IMAGE_WIDTH, IMAGE_HEIGHT } from '@/lib/slide-image-templates'
import { renderSlideImage } from '@/lib/render-slide-image'
import { uploadSlideImage } from '@/lib/upload-slide-image'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Google側でトークンが失効/取り消されたときのエラー形状（gaxios）を判定する */
function isInvalidGrantError(err: unknown): boolean {
  const data = (err as { response?: { data?: { error?: string } } } | undefined)?.response?.data
  if (data?.error === 'invalid_grant') return true
  return err instanceof Error && err.message.includes('invalid_grant')
}

/**
 * POST /api/interviews/[id]/slides — スライド資料を自動生成する（editor+）。
 * 生成先は呼び出した本人が接続済みのGoogleアカウントのDrive。
 * 押すたびに毎回新しいファイルを作る（前回分の上書き・追記はしない）。
 * 共有設定は自動で付与しない（作成者のみアクセス可のまま）。
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { userId, orgId } = await requireRole('editor')
    const { id } = await props.params
    const origin = req.nextUrl.origin

    // 相互に独立したチェックなので並行に行う
    const [interview, client] = await Promise.all([
      prisma.interview.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true, title: true, objective: true, description: true,
          type: true, usabilityMode: true, stimulusUrl: true,
        },
      }),
      getAuthorizedClientForUser(userId, origin),
    ])
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!client) {
      return NextResponse.json({ error: 'google_not_connected' }, { status: 400 })
    }

    // 画面の「結果サマリー」と同じ母集団（パイロットを除く全セッション。分析未完了でも実測値は含む）。
    // ※感情の傾向だけは画面のレーダーチャートに合わせ computeSlideStats 内で done のみに絞る
    const [sessions, highlights] = await Promise.all([
      prisma.session.findMany({
        where: { interviewId: id, isPilot: false },
        select: {
          id: true,
          status: true,
          createdAt: true,
          participant: { select: { name: true } },
          taskResults: {
            orderBy: { order: 'asc' },
            select: { taskId: true, order: true, text: true, outcome: true, durationSec: true, seq: true, usedHint: true, assistedStart: true, excludedAt: true },
          },
          answers: {
            orderBy: { order: 'asc' },
            select: { questionId: true, order: true, text: true, type: true, valueNum: true, valueText: true, followUpCount: true, sentiment: true, excludedAt: true },
          },
          emotions: { select: { happy: true, neutral: true, sad: true, surprised: true } },
          transcript: { select: { summary: true } },
        },
      }),
      prisma.highlight.findMany({
        where: { session: { interviewId: id, isPilot: false } },
        select: { quote: true, note: true, session: { select: { participant: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const slideSessions: SlideSession[] = sessions.map((s) => ({
      id: s.id,
      participantName: s.participant?.name ?? 'Anonymous',
      status: s.status,
      createdAt: s.createdAt,
      taskResults: s.taskResults.map((t) => ({ ...t, excludedAt: t.excludedAt?.toISOString() ?? null })),
      answers: s.answers.map((a) => ({ ...a, excludedAt: a.excludedAt?.toISOString() ?? null })),
      emotions: s.emotions,
    }))

    const stats = computeSlideStats(slideSessions)
    const highlightRows = highlights.map((h) => ({ quote: h.quote, note: h.note }))

    // 発言の要約だけでなく、成功率・スコア・感情などの実数値を踏まえた「事実・仮説・
    // 次のアクション」構成の総括をスライド用に生成する（画面の共通インサイトは発言の
    // 要約だけを見て書くため、ユーザビリティテストのように会話が薄い調査だと
    // 実測値と無関係な文章になってしまう問題があった）。
    // 仮説には根拠にした参加者を明記させるため、参加者名付きで要約・ハイライトを渡す
    const participantSummaries = sessions
      .filter((s) => s.transcript?.summary)
      .map((s, i) => `参加者${i + 1}（${s.participant?.name ?? 'Anonymous'}）: ${s.transcript!.summary}`)
      .join('\n')
    const highlightLines = highlights
      .map((h) => {
        const who = h.session.participant?.name ?? 'Anonymous'
        return `- 参加者「${who}」: ${h.note ? `${h.quote}（${h.note}）` : h.quote}`
      })
      .join('\n')
    const qualitativeText = [participantSummaries, highlightLines].filter(Boolean).join('\n\n')

    const summary = stats.participantCount > 0
      ? await generateSlideSummary({
          title: interview.title,
          objective: interview.objective,
          statsText: renderStatsText(stats),
          qualitativeText,
        })
      : null

    // 仮説の「（参加者: 〇〇）」という言及にリンクを張るための、参加者名→セッション詳細URLの対応。
    // 同名の参加者が複数いる場合は最初のセッションを採用する（厳密な一意性までは求めない）
    const appOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? origin).replace(/\/+$/, '')
    const participantLinks: Record<string, string> = {}
    for (const s of sessions) {
      const name = s.participant?.name
      if (name && !(name in participantLinks)) {
        participantLinks[name] = `${appOrigin}/dashboard/sessions/${s.id}`
      }
    }

    const intro = (interview.objective || interview.description)
      ? { objective: interview.objective, description: interview.description }
      : null

    const stimulus = await buildStimulusSection(interview)

    const sections = buildSlideSections({
      title: interview.title,
      stats,
      intro,
      stimulus,
      summary,
      highlights: highlightRows,
    })

    try {
      // 各セクションをJSXからPNGへ描画し、公開Blobストアへ上げてSlidesから参照できるURLにする
      // （相互に独立した描画・アップロードなので並行に行う）
      const imageUrls = await Promise.all(
        sections.map(async (section, i) => {
          const buffer = await renderSlideImage(renderSection(section), IMAGE_WIDTH, IMAGE_HEIGHT)
          return uploadSlideImage(buffer, `slides/${id}/${i}.png`)
        })
      )
      const { url } = await createSlideDeck(client, interview.title, imageUrls, participantLinks)
      return NextResponse.json({ url })
    } catch (err) {
      if (isInvalidGrantError(err)) {
        // 接続が失効している。DB側の記録も消し、次回は「未接続」として再接続を促す
        await prisma.user.update({
          where: { id: userId },
          data: { googleRefreshToken: null, googleEmail: null, googleConnectedAt: null },
        }).catch(() => {})
        return NextResponse.json({ error: 'google_not_connected' }, { status: 400 })
      }
      throw err
    }
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * テストで使われた画像・サイトを「テスト対象」スライドとして可視化するためのデータを組み立てる。
 * - 印象テスト: 提示した画像をそのまま埋め込む
 * - ユーザビリティテスト（実サービス）: 対象サイトのスクリーンショットを埋め込む
 *   （WordPress.com の mshots — 無料・APIキー不要の公開スクリーンショットサービスを使う。
 *   初回アクセスだと未生成のプレースホルダーが返ることがあるため、一度アクセスして
 *   生成を促してから使う。失敗しても致命的ではないのでベストエフォートで無視する）
 * - ユーザビリティテスト（プロトタイプ）: スクリーンショットはできないためリンクのみ
 */
async function buildStimulusSection(interview: {
  type: string
  usabilityMode: string | null
  stimulusUrl: string | null
}): Promise<{ imageUrl: string | null; caption: string } | null> {
  if (!interview.stimulusUrl) return null

  if (interview.type === 'impression') {
    return { imageUrl: interview.stimulusUrl, caption: '提示した画像' }
  }

  if (interview.type === 'usability' && interview.usabilityMode === 'service') {
    const shotUrl = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(interview.stimulusUrl)}?w=1200`
    try {
      await fetch(shotUrl, { signal: AbortSignal.timeout(5000) })
    } catch {
      // 生成を促す試みが失敗しても、URL自体はそのまま使う（プレースホルダーが出るだけ）
    }
    return { imageUrl: shotUrl, caption: `対象サービス: ${interview.stimulusUrl}` }
  }

  if (interview.type === 'usability' && interview.usabilityMode === 'prototype') {
    return { imageUrl: null, caption: `対象プロトタイプ: ${interview.stimulusUrl}` }
  }

  return null
}
