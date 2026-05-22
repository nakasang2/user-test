import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { hasPermission } from '@/lib/permissions'

const updateSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
})

/** PATCH /api/organizations/members/[userId] — ロール変更 (admin+) */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: callerId, orgId, role: callerRole } = await requireRole('admin')
    const { userId: targetUserId } = await props.params

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { role: newRole } = parsed.data

    // 対象メンバーを確認
    const target = await prisma.member.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // owner は変更不可
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'オーナーのロールは変更できません' }, { status: 403 })
    }

    // 自分より上のロールへの昇格は不可（admin は owner にできない）
    if (!hasPermission(callerRole, newRole as 'admin' | 'editor' | 'viewer')) {
      return NextResponse.json({ error: '自分と同等以上のロールには変更できません' }, { status: 403 })
    }

    const updated = await prisma.member.update({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
      data: { role: newRole },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    return NextResponse.json(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

/** DELETE /api/organizations/members/[userId] — メンバー削除 (admin+) */
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: callerId, orgId } = await requireRole('admin')
    const { userId: targetUserId } = await props.params

    // 自分自身は削除不可
    if (callerId === targetUserId) {
      return NextResponse.json({ error: '自分自身は削除できません' }, { status: 400 })
    }

    const target = await prisma.member.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // owner は削除不可
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'オーナーは削除できません' }, { status: 403 })
    }

    await prisma.member.delete({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
