import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { signToken } from '@/lib/jwt'
import { handleApiError } from '@/lib/api-auth'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      // タイミング攻撃対策：ユーザーが存在しない場合もハッシュ比較時間を消費
      // （正しい形式の bcrypt ハッシュでないと compare が即 return して対策にならない）
      await bcrypt.compare(password, '$2b$12$2VzegPrc.0dUVVrUBTUQFebKnB7A.KwfLWD8SsB24FmleVF6nIcMu')
      return NextResponse.json({ error: 'メールアドレスまたはパスワードが違います' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'メールアドレスまたはパスワードが違います' }, { status: 401 })
    }

    // 既存ユーザーの Member レコードを自動作成（マイグレーション対応）
    await prisma.member.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: user.organizationId } },
      create: { userId: user.id, organizationId: user.organizationId, role: user.role || 'owner' },
      update: {},
    })

    const token = await signToken({ userId: user.id, orgId: user.organizationId, email: user.email })

    const res = NextResponse.json({ ok: true })
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
