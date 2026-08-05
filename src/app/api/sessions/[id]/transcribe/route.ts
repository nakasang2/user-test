import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { reanalyzeFromRecording } from '@/lib/reanalyze-recording'

export const runtime = 'nodejs'
// Whisper + 分析はやや時間がかかるため上限を引き上げる
export const maxDuration = 300

/**
 * POST /api/sessions/[id]/transcribe — 保存済み録画から Whisper で再文字起こしし、
 * AI 分析を実行してトランスクリプトを更新する（認証＋組織所有権）。
 * ブラウザのライブ文字起こしより高精度なテキストが必要な場合に使用する。
 * 注: Whisper は話者分離に非対応のため、セグメントの話者は 'Unknown' になる。
 *
 * 実処理は lib/reanalyze-recording.ts に集約している
 * （ユーザビリティテストの録画保存完了時の自動実行からも同じ処理を呼ぶため）。
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params

    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true, recordingUrl: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!session.recordingUrl) {
      return NextResponse.json({ error: '録画がありません' }, { status: 400 })
    }

    await reanalyzeFromRecording(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
