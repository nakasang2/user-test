import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { signToken } from '@/lib/jwt'
import { handleApiError } from '@/lib/api-auth'

const schema = z.object({
  orgName:  z.string().min(1, '組織名を入力してください').max(100),
  name:     z.string().min(1, '名前を入力してください').max(100),
  email:    z.string().email('有効なメールアドレスを入力してください'),
  password: z.string().min(8, 'パスワードは8文字以上にしてください'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '入力内容を確認してください'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { orgName, name, email, password } = parsed.data

    // メール重複チェック
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'このメールアドレスは既に使用されています' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    // トランザクションで組織・ユーザーを一括作成
    const { org, user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: orgName } })
      const user = await tx.user.create({
        data: { email, name, passwordHash, organizationId: org.id, role: 'owner' },
      })
      // 既存の未所属インタビューをこの組織に割り当て（初回登録時の自動マイグレーション）
      await tx.interview.updateMany({
        where: { organizationId: null },
        data: { organizationId: org.id },
      })
      return { org, user }
    })

    const token = await signToken({ userId: user.id, orgId: org.id, email: user.email })

    const res = NextResponse.json({ ok: true }, { status: 201 })
    res.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7日
      path: '/',
    })
    return res
  } catch (err) {
    return handleApiError(err)
  }
}
