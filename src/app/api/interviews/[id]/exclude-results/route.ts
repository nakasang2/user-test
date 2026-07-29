import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/**
 * POST /api/interviews/[id]/exclude-results
 * タスク結果・回答を「集計対象外」にする／戻す。
 *
 * 調査からタスクを削除したときは編集 API 側が自動で印を付けるが、
 * この仕組みより前に削除された分は外部キーが既に NULL で、
 * どのタスクのものだったか特定できない。それらをリサーチャーが
 * 画面を見て判断し、手動で外せるようにするための入口。
 *
 * 対象の指定は集計と同じキー（taskId / questionId、無ければ文言）で行う。
 * 画面の1行 = ここでの1グループなので、行の操作がそのまま反映される。
 *
 * 認証必須。被験者が自分の悪い結果を集計から外せる状態を作らないため。
 */
const bodySchema = z.object({
  kind: z.enum(['task', 'answer']),
  /** 現存する項目の id。削除済み・旧データの場合は null で、代わりに text で特定する */
  id: z.string().min(1).max(200).nullable().optional(),
  /**
   * id が無い行を特定するための文言（実施時点のスナップショット）。
   * 空文字も有効な対象（保存時に text が空で入った行が存在しうる）なので min(1) は付けない。
   */
  text: z.string().max(2000).nullable().optional(),
  excluded: z.boolean(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params

    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const { kind, id: targetId, text, excluded } = parsed.data
    // text は空文字も有効なので、未指定（null/undefined）かどうかで判定する
    if (!targetId && text == null) {
      return NextResponse.json({ error: '対象を特定できません' }, { status: 400 })
    }

    // 対象は必ずこの調査のセッション配下に限定する（他組織のデータに触れないため）
    const sessionFilter = { session: { interviewId: id } }
    const excludedAt = excluded ? new Date() : null

    // id があれば id で、無ければ「id が無い かつ 文言が一致」する行だけを対象にする。
    // 文言だけで広く引くと、同じ文言の現存タスク（id 付き）まで巻き込んでしまう。
    if (kind === 'task') {
      const where = targetId
        ? { ...sessionFilter, taskId: targetId }
        : { ...sessionFilter, taskId: null, text: text! }
      const res = await prisma.taskResult.updateMany({ where, data: { excludedAt } })
      return NextResponse.json({ ok: true, updated: res.count })
    }

    const where = targetId
      ? { ...sessionFilter, questionId: targetId }
      : { ...sessionFilter, questionId: null, text: text! }
    const res = await prisma.answer.updateMany({ where, data: { excludedAt } })
    return NextResponse.json({ ok: true, updated: res.count })
  } catch (err) {
    return handleApiError(err)
  }
}
