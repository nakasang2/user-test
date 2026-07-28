import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'

/** ハイライトの編集・削除。編集権限（editor 以上）＋組織所有権を要求する。 */

const patchSchema = z.object({
  note: z.string().max(4000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
})

/** ハイライトが認証ユーザーの組織のものか確認する */
async function assertOwned(highlightId: string, orgId: string) {
  const owned = await prisma.highlight.findFirst({
    where: { id: highlightId, session: { interview: { organizationId: orgId } } },
    select: { id: true },
  })
  return !!owned
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params
    if (!(await assertOwned(id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }

    // 送られたフィールドだけを更新する（未指定は現状維持）
    const data: { note?: string | null; tags?: string[] } = {}
    if ('note' in parsed.data) data.note = parsed.data.note || null
    if (parsed.data.tags) {
      data.tags = [...new Set(parsed.data.tags.map((t) => t.trim()).filter(Boolean))]
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const highlight = await prisma.highlight.update({ where: { id }, data })
    return NextResponse.json({ highlight })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params
    if (!(await assertOwned(id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await prisma.highlight.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
