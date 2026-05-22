import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { ASSIGNABLE_ROLES } from '@/lib/permissions'

const createSchema = z.object({
  role:  z.enum(['admin', 'editor', 'viewer']).default('viewer'),
  email: z.string().email().optional().or(z.literal('')),
})

/** GET /api/organizations/invites — 有効な招待一覧 (admin+) */
export async function GET() {
  try {
    const { orgId } = await requireRole('admin')
    const invites = await prisma.invite.findMany({
      where: { organizationId: orgId, usedAt: null, expiresAt: { gt: new Date() } },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(invites)
  } catch (err) {
    return handleApiError(err)
  }
}

/** POST /api/organizations/invites — 招待リンク生成 (admin+) */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await requireRole('admin')
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { role, email } = parsed.data

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7日後

    const invite = await prisma.invite.create({
      data: {
        organizationId: orgId,
        createdById:    userId,
        role,
        email:          email || null,
        expiresAt,
      },
    })

    return NextResponse.json(invite, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
