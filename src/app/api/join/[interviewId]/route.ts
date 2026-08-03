import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { randomBytes } from 'crypto'
import { handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'
import { estimateMinutes } from '@/lib/duration-estimate'

const joinSchema = z.object({
  name:  z.string().min(1, '名前を入力してください').max(100),
  email: z.string().email().optional().or(z.literal('')),
  // 録画・表情分析・AI処理への同意。証跡として Session.consentedAt に記録する。
  // 旧クライアント互換のため任意項目にするが、false 明示は拒否する。
  consent: z.boolean().optional(),
  // スクリーニング回答（questionId -> 選んだ選択肢）
  screenerAnswers: z.array(z.object({
    questionId: z.string(),
    value: z.string().max(200),
  })).max(50).optional(),
})

/** GET /api/join/[interviewId] — インタビュータイトルなど公開情報を返す（認証不要） */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  try {
    const { interviewId } = await props.params
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true, title: true, description: true, type: true,
        // 参加前チェックで、小窓と画面録画の確認が要るかどうかの判定に使う
        usabilityMode: true,
        screeners: {
          orderBy: { order: 'asc' },
          // disqualify（足切り条件）は被験者に見せない
          select: { id: true, label: true, options: true, required: true, order: true },
        },
        seqEnabled: true,
        // 所要時間の算出に必要な設問構成（本文は返さない）
        questions: { select: { type: true } },
        _count: { select: { tasks: true } },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 所要時間はサーバー側で算出して返す（表示側に計算ロジックを持たせない）
    const openQuestions = interview.questions.filter((q) => (q.type ?? 'open') === 'open').length
    const estimate = estimateMinutes({
      openQuestions,
      scaleQuestions: interview.questions.length - openQuestions,
      tasks: interview._count.tasks,
      seqEnabled: interview.seqEnabled,
      screeners: interview.screeners.length,
    })

    // questions は件数の算出にしか使わないのでレスポンスからは外す
    const { questions: _q, seqEnabled: _s, ...rest } = interview
    void _q; void _s
    return NextResponse.json({ ...rest, estimate })
  } catch (err) {
    return handleApiError(err)
  }
}

/** POST /api/join/[interviewId] — 参加者登録＋セッション自動生成（認証不要） */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ interviewId: string }> },
) {
  try {
    const { interviewId } = await props.params
    // 未認証エンドポイント。セッションと Daily ルームを無制限に作られるのを防ぐ。
    // スクリーニングの足切り条件を総当たりで探る行為の抑止も兼ねる。
    if (!(await rateLimit(`join:${interviewId}:${getClientIp(req)}`, 10, 300))) {
      return NextResponse.json({ error: 'しばらく時間をおいてから再度お試しください' }, { status: 429 })
    }
    const body = await req.json()
    const parsed = joinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { name, email, consent, screenerAnswers } = parsed.data
    if (consent === false) {
      return NextResponse.json({ error: '参加には同意が必要です' }, { status: 400 })
    }

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: { screeners: { orderBy: { order: 'asc' } } },
    })
    if (!interview) return NextResponse.json({ error: 'インタビューが見つかりません' }, { status: 404 })

    // スクリーニング判定。足切りはサーバー側でのみ行う（条件をクライアントに出さない）。
    const answersByQuestion = new Map((screenerAnswers ?? []).map((a) => [a.questionId, a.value]))
    const resolvedScreeners: { questionId: string; label: string; value: string; order: number }[] = []
    for (const sc of interview.screeners) {
      const value = answersByQuestion.get(sc.id)
      if (!value) {
        if (sc.required) {
          return NextResponse.json({ error: '事前質問にすべてお答えください' }, { status: 400 })
        }
        continue
      }
      // 選択肢に無い値は受け付けない
      if (sc.options.length > 0 && !sc.options.includes(value)) {
        return NextResponse.json({ error: '選択肢から選んでください' }, { status: 400 })
      }
      if (sc.disqualify.includes(value)) {
        // 対象外。セッションも参加者も作らない（理由は伝えない）
        return NextResponse.json({ disqualified: true }, { status: 200 })
      }
      resolvedScreeners.push({ questionId: sc.id, label: sc.label, value, order: sc.order })
    }

    const participant = await prisma.participant.create({
      data: { name, email: email || null },
    })

    // roomName を知るだけで /interview/[roomName] から participantToken を取得できるため、
    // 列挙されないよう十分なエントロピー（96bit）を持たせる
    const roomName = `interview-${randomBytes(12).toString('hex')}`
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    // 被験者が実際に開く URL。以前は Daily のルームを作っていたが、
    // アプリ側は自前の録画・文字起こしに移行しており誰も接続しないため廃止した。
    const dailyRoomUrl = `${origin}/interview/${roomName}`

    // 被験者フロー（未認証）が自分のセッションにのみ結果送信できるよう、
    // 高エントロピーの秘密トークンを発行する。被験者ページのサーバーコンポーネント経由でのみ渡す。
    const participantToken = randomBytes(32).toString('base64url')
    const session = await prisma.session.create({
      data: {
        interviewId,
        participantId: participant.id,
        dailyRoomName: roomName,
        dailyRoomUrl,
        participantToken,
        consentedAt: consent ? new Date() : null, // 同意の証跡
        screenerAnswers: {
          create: resolvedScreeners.map((a) => ({
            questionId: a.questionId, label: a.label, value: a.value, order: a.order,
          })),
        },
      },
    })

    return NextResponse.json({
      sessionId: session.id,
      roomName,
      interviewUrl: `${origin}/interview/${roomName}`,
    }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
