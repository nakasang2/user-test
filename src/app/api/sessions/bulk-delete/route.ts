import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { deleteSessionWithBlob } from '@/lib/delete-interview'

const bodySchema = z.object({
  // 一覧画面から選べる件数に上限を設ける（誤操作・タイムアウト対策）
  ids: z.array(z.string()).min(1).max(100),
})

/**
 * POST /api/sessions/bulk-delete — 複数のセッションをまとめて削除する。
 *
 * 1件ずつ独立に処理する。組織所有権のチェックは deleteSessionWithBlob 内の
 * `interview: { organizationId: orgId }` 条件で行われるため、他組織の
 * セッション id を混ぜて送られても、それだけ "not found" として failed に入る。
 */
export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireRole('editor')
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const ids = [...new Set(parsed.data.ids)]

    const deleted: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const id of ids) {
      const result = await deleteSessionWithBlob(id, orgId)
      if (result.ok) deleted.push(id)
      else failed.push({ id, error: result.error })
    }

    return NextResponse.json({ deleted, failed })
  } catch (err) {
    return handleApiError(err)
  }
}
