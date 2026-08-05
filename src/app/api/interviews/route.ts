import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FOLLOW_UP_DEPTH_MIN, FOLLOW_UP_DEPTH_MAX, normalizeFollowUpDepth } from '@/lib/follow-up'
import { prisma } from '@/lib/db'
import { generateInterviewQuestions } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'
import { toQuestionImagePayload } from '@/lib/question-image'

const createSchema = z.object({
  title:            z.string().min(1, 'タイトルを入力してください').max(200),
  description:      z.string().max(1000).optional(),
  autoGenerate:     z.boolean().optional(),
  topic:            z.string().max(500).optional(),
  questions:        z.array(z.union([
    z.string(),
    z.object({
      text: z.string(),
      type: z.string().optional(),
      // 印象テストで質問ごとに提示する画像。編集 API と同じ制約に揃える
      imageUrl: z.string().url().max(2000).nullable().optional(),
      imageMode: z.enum(['persistent', 'timed']).nullable().optional(),
      imageDuration: z.number().int().min(1).max(60).nullable().optional(),
      // この質問で AI が深掘りするか。未指定は true（従来どおり）
      followUpEnabled: z.boolean().optional(),
      // 深掘りの深さ。範囲は lib/follow-up.ts に集約
      followUpDepth: z.number().int().min(FOLLOW_UP_DEPTH_MIN).max(FOLLOW_UP_DEPTH_MAX).optional(),
      // rating/nps でもボタンを出さず会話の中で自然に聞き、値は後で抽出する
      naturalCapture: z.boolean().optional(),
    }),
  ])).optional(),
  type:             z.enum(['interview', 'impression', 'usability']).default('interview'),
  usabilityMode:    z.enum(['prototype', 'service']).optional(),
  stimulusUrl:      z.string().url().optional().or(z.literal('')),
  stimulusDuration: z.number().int().min(1).max(60).optional(),
  // hint: 詰まった参加者に見せるヒント。全員に同じ文言を出して比較可能性を保つ
  tasks:            z.array(z.object({
    // 編集 API（[id]/route.ts）と同じ制約に揃える
    text: z.string().min(1).max(2000),
    order: z.number(),
    hint: z.string().max(2000).nullable().optional(),
    // このタスクの結果が次のタスクの前提になるか（断念しても即座に次へ進めない）
    isPrerequisite: z.boolean().optional(),
  })).optional(),
  seqEnabled:       z.boolean().optional(),
  // 詰まった参加者への声かけまでの秒数。null / 未指定なら声かけしない。
  // 編集 API（[id]/route.ts）と同じ範囲にする
  hintDelaySec:     z.number().int().min(10).max(1800).nullable().optional(),
  // 事前質問（スクリーニング／属性）。編集 API（[id]/route.ts）と同じ制約に揃える。
  // 作成時に設定できないと、作ってから編集画面を開き直す二度手間になる
  screeners:        z.array(z.object({
    label:      z.string().min(1).max(500),
    // 選択肢ゼロだと被験者が回答できず、必須なら誰も参加できなくなるため最低1つ必須
    options:    z.array(z.string().min(1).max(200)).min(1, '選択肢を1つ以上入力してください').max(20),
    disqualify: z.array(z.string().max(200)).max(20).default([]),
    required:   z.boolean().default(true),
  })).max(20).optional(),
})

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const interviews = await prisma.interview.findMany({
      where: { organizationId: orgId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        tasks: { orderBy: { order: 'asc' } },
        // 件数はパイロット（リサーチャーの試行）を除いた本番セッション数
        _count: { select: { sessions: { where: { isPilot: false } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(interviews)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    const { title, description, questions, autoGenerate, topic, type, usabilityMode, stimulusUrl, stimulusDuration, tasks, seqEnabled, hintDelaySec, screeners } = parsed.data

    type QuestionInput =
      | { text: string; type?: string; imageUrl?: string | null; imageMode?: string | null; imageDuration?: number | null; followUpEnabled?: boolean; followUpDepth?: number; naturalCapture?: boolean }
      | string
    let questionList: QuestionInput[] = questions ?? []

    if (autoGenerate && topic) {
      const generated = await generateInterviewQuestions(topic, 5)
      questionList = generated.map((text) => ({ text, type: 'open' }))
    }

    const interview = await prisma.interview.create({
      data: {
        organizationId: orgId,
        title,
        description,
        type,
        usabilityMode: usabilityMode ?? null,
        stimulusUrl: stimulusUrl || null,
        stimulusDuration: stimulusDuration ?? null,
        seqEnabled: seqEnabled ?? false,
        hintDelaySec: hintDelaySec ?? null,
        questions: {
          create: questionList.map((q: QuestionInput, index: number) => ({
            text: typeof q === 'string' ? q : q.text,
            type: typeof q === 'string' ? 'open' : (q.type ?? 'open'),
            order: index + 1,
            // 画像が無ければ見せ方も秒数も残さない（使われない値を保存しない）
            ...toQuestionImagePayload(typeof q === 'string' ? {} : q),
            // 深掘りの ON/OFF と深さ。未指定は既定（従来どおり）
            followUpEnabled: typeof q === 'string' ? true : (q.followUpEnabled ?? true),
            followUpDepth: normalizeFollowUpDepth(typeof q === 'string' ? undefined : q.followUpDepth),
            naturalCapture: typeof q === 'string' ? false : (q.naturalCapture ?? false),
          })),
        },
        tasks: {
          create: (tasks ?? []).map(t => ({
            text: t.text.trim(),
            order: t.order,
            hint: t.hint?.trim() || null,
            isPrerequisite: t.isPrerequisite === true,
          })),
        },
        screeners: {
          create: (screeners ?? []).map((x, index) => ({
            label: x.label,
            options: x.options,
            // 編集 API と同じく、選択肢に無い値は参加不可条件として採用しない
            disqualify: x.disqualify.filter((d) => x.options.includes(d)),
            required: x.required,
            order: index + 1,
          })),
        },
      },
      include: {
        questions: { orderBy: { order: 'asc' } },
        tasks: { orderBy: { order: 'asc' } },
        screeners: { orderBy: { order: 'asc' } },
      },
    })

    return NextResponse.json(interview, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
