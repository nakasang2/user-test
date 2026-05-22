import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { signToken } from '@/lib/jwt'
import { handleApiError } from '@/lib/api-auth'

const acceptSchema = z.object({
  name:     z.string().min(1, '名前を入力してください').max(100),
  email:    z.string().email('有効なメールアドレスを入力してください'),
  password: z.string().min(8, 'パスワードは8文字以上にしてください'),
})

/** GET /api/invite/[token] — 招待の公開情報を返す（認証不要） */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await props.params
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    })

    if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
    if (invite.usedAt) return NextResponse.json({ error: 'この招待リンクは既に使用されています' }, { status: 410 })
    if (invite.expiresAt < new Date()) return NextResponse.json({ error: '招待リンクの有効期限が切れています' }, { status: 410 })

    return NextResponse.json({
      orgName: invite.organization.name,
      role:    invite.role,
      email:   invite.email, // 特定メール指定があれば返す（フォームに pre-fill）
    })
  } catch (err) {
    return handleApiError(err)
  }
}

/** POST /api/invite/[token] — 招待を受け入れてアカウント作成（認証不要） */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await props.params
    const body = await req.json()
    const parsed = acceptSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { name, email, password } = parsed.data

    // 招待チェック
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { organization: true },
    })
    if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
    if (invite.usedAt) return NextResponse.json({ error: 'この招待リンクは既に使用されています' }, { status: 410 })
    if (invite.expiresAt < new Date()) return NextResponse.json({ error: '招待リンクの有効期限が切れています' }, { status: 410 })

    // メール限定招待の場合、一致チェック
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'この招待は別のメールアドレス宛てです' }, { status: 403 })
    }

    // 既存ユーザーチェック
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      // 既存ユーザーなら Member に追加するだけ（パスワード不要フロー）
      const alreadyMember = await prisma.member.findUnique({
        where: { userId_organizationId: { userId: existing.id, organizationId: invite.organizationId } },
      })
      if (alreadyMember) {
        return NextResponse.json({ error: 'このユーザーは既に組織のメンバーです' }, { status: 409 })
      }

      const jwtToken = await prisma.$transaction(async (tx) => {
        await tx.member.create({
          data: { userId: existing.id, organizationId: invite.organizationId, role: invite.role },
        })
        await tx.invite.update({ where: { token }, data: { usedAt: new Date() } })
        return signToken({ userId: existing.id, orgId: invite.organizationId, email: existing.email })
      })

      const res = NextResponse.json({ ok: true }, { status: 200 })
      res.cookies.set('token', await jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      })
      return res
    }

    // 新規ユーザー作成
    const passwordHash = await bcrypt.hash(password, 12)

    const { user } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          organizationId: invite.organizationId,
          role:           invite.role,
        },
      })
      await tx.member.create({
        data: { userId: user.id, organizationId: invite.organizationId, role: invite.role },
      })
      await tx.invite.update({ where: { token }, data: { usedAt: new Date() } })
      return { user }
    })

    const jwtToken = await signToken({ userId: user.id, orgId: invite.organizationId, email: user.email })

    const res = NextResponse.json({ ok: true }, { status: 201 })
    res.cookies.set('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
    return res
  } catch (err) {
    return handleApiError(err)
  }
}
