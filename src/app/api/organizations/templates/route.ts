import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAuth, requireRole, getRole, handleApiError } from '@/lib/api-auth'

/**
 * GET /api/organizations/templates — 現在の組織のテンプレート（説明欄の「テンプレートを挿入」用）。
 * 挿入ボタンは editor 以上が使うため、閲覧は admin に絞らず認証済みなら誰でも可。
 * 書き込みだけ admin+ に絞る（メンバー管理と同じ考え方）。
 */
export async function GET() {
  try {
    const { userId, orgId } = await requireAuth()
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { templateInterview: true, templateImpression: true, templateUsability: true },
    })
    if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const viewerRole = await getRole(userId, orgId)
    return NextResponse.json({ ...org, viewerRole })
  } catch (err) {
    return handleApiError(err)
  }
}

// 上限は挿入先の description の上限(1000)と揃える。ここだけ長く保存できると、
// テンプレートを挿入した瞬間に description 側の保存エラーになる
const patchSchema = z.object({
  templateInterview: z.string().max(1000).nullable().optional(),
  templateImpression: z.string().max(1000).nullable().optional(),
  templateUsability: z.string().max(1000).nullable().optional(),
})

/** PATCH /api/organizations/templates — テンプレートを更新（admin+）。空文字は null にし、既定文言へ戻す */
export async function PATCH(req: NextRequest) {
  try {
    const { orgId } = await requireRole('admin')
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const { templateInterview, templateImpression, templateUsability } = parsed.data
    const data: Record<string, string | null> = {}
    if (templateInterview !== undefined) data.templateInterview = templateInterview?.trim() || null
    if (templateImpression !== undefined) data.templateImpression = templateImpression?.trim() || null
    if (templateUsability !== undefined) data.templateUsability = templateUsability?.trim() || null

    const org = await prisma.organization.update({
      where: { id: orgId },
      data,
      select: { templateInterview: true, templateImpression: true, templateUsability: true },
    })
    return NextResponse.json(org)
  } catch (err) {
    return handleApiError(err)
  }
}
