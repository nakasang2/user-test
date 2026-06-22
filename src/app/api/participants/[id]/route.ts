import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/**
 * DELETE /api/participants/[id] — 被験者からの削除請求（DSR）対応の枠。
 * 呼び出し元の組織が保有する当該被験者のセッション（録画・文字起こし・感情データ）を削除する。
 * 他組織に残るデータには触れず、残存セッションが無くなった場合のみ Participant レコードを削除する。
 * admin 以上の権限を要求する。
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('admin')
    const { id } = await props.params

    // 当該組織が保有する、この被験者のセッションのみを対象にする
    const sessions = await prisma.session.findMany({
      where: { participantId: id, interview: { organizationId: orgId } },
      select: { id: true, recordingUrl: true },
    })

    // 録画 Blob を削除（失敗しても DB 削除は続行）
    for (const s of sessions) {
      if (s.recordingUrl) {
        try { await del(s.recordingUrl) } catch (e) { console.error('Blob deletion failed (continuing):', e) }
      }
    }

    // セッション削除（Transcript / EmotionResult は onDelete: Cascade で連動削除）
    await prisma.session.deleteMany({
      where: { id: { in: sessions.map((s) => s.id) } },
    })

    // 他組織を含めセッションが残っていなければ Participant 本体も削除
    const remaining = await prisma.session.count({ where: { participantId: id } })
    if (remaining === 0) {
      await prisma.participant.delete({ where: { id } }).catch(() => {})
    }

    return NextResponse.json({ ok: true, deletedSessions: sessions.length, participantDeleted: remaining === 0 })
  } catch (err) {
    return handleApiError(err)
  }
}
