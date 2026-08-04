import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { deleteInterviewWithBlobs } from '@/lib/delete-interview'

const bodySchema = z.object({
  // 一覧画面から選べる件数に上限を設ける（誤操作・タイムアウト対策）
  ids: z.array(z.string()).min(1).max(50),
})

/**
 * POST /api/interviews/bulk-delete — 複数のテストをまとめて削除する。
 *
 * 1件ずつ独立に処理する（全件ロールバックの $transaction にはしない）。
 * 理由: 対象は互いに無関係な複数の調査で、1件の Blob 削除がたまたま失敗しても
 * 他の調査の削除まで巻き込んで止めたくない。結果は成功/失敗の内訳で返し、
 * 画面側で「N件削除・M件失敗」を報告できるようにする。
 */
export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireRole('admin')
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    // 同じ id が重複送信されても1回しか処理しない
    const ids = [...new Set(parsed.data.ids)]

    const deleted: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const id of ids) {
      const result = await deleteInterviewWithBlobs(id, orgId)
      if (result.ok) deleted.push(id)
      else failed.push({ id, error: result.error })
    }

    return NextResponse.json({ deleted, failed })
  } catch (err) {
    return handleApiError(err)
  }
}
