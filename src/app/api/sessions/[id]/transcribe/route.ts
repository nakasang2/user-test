import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { createSignedBlobUrl } from '@/lib/blob'
import { transcribeFromUrl } from '@/lib/whisper'
import { analyzeTranscript } from '@/lib/ai'

export const runtime = 'nodejs'
// Whisper + 分析はやや時間がかかるため上限を引き上げる
export const maxDuration = 300

/**
 * POST /api/sessions/[id]/transcribe — 保存済み録画から Whisper で再文字起こしし、
 * AI 分析を実行してトランスクリプトを更新する（認証＋組織所有権）。
 * ブラウザのライブ文字起こしより高精度なテキストが必要な場合に使用する。
 * 注: Whisper は話者分離に非対応のため、セグメントの話者は 'Unknown' になる。
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params

    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      include: { interview: { include: { questions: true } } },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!session.recordingUrl) {
      return NextResponse.json({ error: '録画がありません' }, { status: 400 })
    }

    // 非公開録画の署名付き URL を発行し、Whisper で文字起こし
    const signedUrl = await createSignedBlobUrl(session.recordingUrl, 10 * 60 * 1000)
    const { fullText, segments } = await transcribeFromUrl(signedUrl)

    // 時刻付きトランスクリプトで AI 分析
    const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
    const timestamped = segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n') || fullText
    const questions = session.interview.questions.map((q) => q.text)
    let summary = ''
    let themes = ''
    try {
      const result = await analyzeTranscript(timestamped, questions)
      summary = result.summary
      themes = result.themes
    } catch (err) {
      console.error('analyzeTranscript failed:', err)
      summary = '分析に失敗しました。'
    }

    const transcript = await prisma.transcript.upsert({
      where: { sessionId: id },
      create: { sessionId: id, fullText, summary, themes },
      update: { fullText, summary, themes },
    })

    // 既存セグメントを Whisper の結果で原子的に置き換える
    await prisma.$transaction([
      prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
      prisma.transcriptSegment.createMany({
        data: segments.map((seg) => ({
          transcriptId: transcript.id,
          speaker: seg.speaker,
          text: seg.text,
          startTime: seg.start,
          endTime: seg.end,
        })),
      }),
    ])

    // process と挙動を揃える: 分析済みにし、比較インサイトのキャッシュを無効化
    await prisma.session.update({ where: { id }, data: { status: 'done' } })
    await prisma.interview.update({
      where: { id: session.interview.id },
      data: { commonInsights: null, insightsCount: null },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
