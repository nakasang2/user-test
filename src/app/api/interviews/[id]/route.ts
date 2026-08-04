import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FOLLOW_UP_DEPTH_MIN, FOLLOW_UP_DEPTH_MAX, normalizeFollowUpDepth } from '@/lib/follow-up'
import { prisma } from '@/lib/db'
import { del } from '@vercel/blob'
import { requireAuth, requireRole, handleApiError } from '@/lib/api-auth'
import { toQuestionImagePayload } from '@/lib/question-image'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        tasks: { orderBy: { order: 'asc' } },
        sessions: {
          include: {
            participant: true,
            transcript: true,
            _count: { select: { emotions: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(interview)
  } catch (err) {
    return handleApiError(err)
  }
}

const patchSchema = z.object({
  title:            z.string().min(1, 'タイトルを入力してください').max(200).optional(),
  description:      z.string().max(1000).nullable().optional(),
  stimulusUrl:      z.string().url().nullable().optional().or(z.literal('')),
  stimulusDuration: z.number().int().min(1).max(60).nullable().optional(),
  seqEnabled:       z.boolean().optional(),
  // 詰まった参加者への声かけまでの秒数。null なら声かけしない。
  // 上限は30分（それ以上は事実上「声かけしない」と同じで、誤入力の可能性が高い）
  hintDelaySec:     z.number().int().min(10).max(1800).nullable().optional(),
  // id 付き = 既存を更新（過去の回答との紐づけを保つ）、id 無し = 新規追加。
  // 送られてこなかった既存項目は削除される。
  questions: z.array(z.object({
    id:   z.string().optional(),
    text: z.string().min(1).max(2000),
    type: z.enum(['open', 'rating', 'nps']).default('open'),
    // 印象テストで質問ごとに提示する画像。作成 API（route.ts）と同じ制約に揃える
    imageUrl: z.string().url().max(2000).nullable().optional(),
    imageMode: z.enum(['persistent', 'timed']).nullable().optional(),
    imageDuration: z.number().int().min(1).max(60).nullable().optional(),
    // この質問で AI が深掘りするか。未指定は変更しない（既存値を保つ）
    followUpEnabled: z.boolean().optional(),
    followUpDepth: z.number().int().min(FOLLOW_UP_DEPTH_MIN).max(FOLLOW_UP_DEPTH_MAX).optional(),
  })).optional(),
  tasks: z.array(z.object({
    id:   z.string().optional(),
    text: z.string().min(1).max(2000),
    // 詰まったときに参加者へ見せるヒント。全員に同じ文言を出して比較可能性を保つ
    hint: z.string().max(2000).nullable().optional(),
    // このタスクの結果が次のタスクの前提になるか（断念しても即座に次へ進めない）
    isPrerequisite: z.boolean().optional(),
  })).optional(),
  // 事前質問（スクリーニング／属性）。disqualify に入れた選択肢を選んだ人は参加不可。
  screeners: z.array(z.object({
    id:         z.string().optional(),
    label:      z.string().min(1).max(500),
    // 選択肢ゼロだと被験者が回答できず、必須なら誰も参加できなくなるため最低1つ必須
    options:    z.array(z.string().min(1).max(200)).min(1, '選択肢を1つ以上入力してください').max(20),
    disqualify: z.array(z.string().max(200)).max(20).default([]),
    required:   z.boolean().default(true),
  })).max(20).optional(),
})

/**
 * PATCH /api/interviews/[id] — 調査の編集。
 *
 * 実施済みセッションがあっても編集できる。過去データが壊れないのは、
 * 回答側（Answer / TaskResult）が質問文・タスク文のスナップショットを持ち、
 * 参照する質問・タスクが消えても onDelete: SetNull で残るため。
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireRole('editor')
    const { id } = await props.params

    const existing = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, questions: { select: { id: true } }, tasks: { select: { id: true } }, screeners: { select: { id: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const { title, description, stimulusUrl, stimulusDuration, seqEnabled, hintDelaySec, questions, tasks, screeners } = parsed.data

    // 他インタビューの id を送られても触らないよう、自分の配下だけを対象にする
    const ownQuestionIds = new Set(existing.questions.map((q) => q.id))
    const ownTaskIds = new Set(existing.tasks.map((t) => t.id))

    const ops = []

    if (questions) {
      const keep = questions.map((q) => (q.id && ownQuestionIds.has(q.id) ? q.id : null)).filter(Boolean) as string[]
      const keepSet = new Set(keep)
      // 削除される質問の回答に、消える前に「集計対象外」の印を付ける。
      // 削除すると questionId が NULL になり、どの質問の回答だったか特定できなくなる
      // （text は実施時点のスナップショットなので、文言を直しただけの現存質問と区別できない）。
      // この updateMany は deleteMany より前に積む必要がある（$transaction は配列順に実行される）。
      const removedQuestionIds = existing.questions.map((q) => q.id).filter((qid) => !keepSet.has(qid))
      if (removedQuestionIds.length > 0) {
        ops.push(prisma.answer.updateMany({
          where: { questionId: { in: removedQuestionIds }, excludedAt: null },
          data: { excludedAt: new Date() },
        }))
      }
      ops.push(prisma.question.deleteMany({ where: { interviewId: id, NOT: { id: { in: keep.length ? keep : ['__none__'] } } } }))
      questions.forEach((q, index) => {
        const order = index + 1
        // 画像は毎回明示的に書く。update で省くと「外したのに残る」、
        // create で省くと「付けたのに保存されない」になる
        const image = toQuestionImagePayload(q)
        // 深掘りの設定。未指定の項目は既存値を変えない（送られてきたものだけ書く）
        const followUp = {
          ...(q.followUpEnabled === undefined ? {} : { followUpEnabled: q.followUpEnabled }),
          ...(q.followUpDepth === undefined ? {} : { followUpDepth: normalizeFollowUpDepth(q.followUpDepth) }),
        }
        if (q.id && ownQuestionIds.has(q.id)) {
          ops.push(prisma.question.update({ where: { id: q.id }, data: { text: q.text, type: q.type, order, ...image, ...followUp } }))
        } else {
          ops.push(prisma.question.create({ data: { interviewId: id, text: q.text, type: q.type, order, ...image, ...followUp } }))
        }
      })
    }

    if (tasks) {
      const keep = tasks.map((t) => (t.id && ownTaskIds.has(t.id) ? t.id : null)).filter(Boolean) as string[]
      const keepSet = new Set(keep)
      // 質問と同じ理由で、削除されるタスクの結果に先に印を付ける
      const removedTaskIds = existing.tasks.map((t) => t.id).filter((tid) => !keepSet.has(tid))
      if (removedTaskIds.length > 0) {
        ops.push(prisma.taskResult.updateMany({
          where: { taskId: { in: removedTaskIds }, excludedAt: null },
          data: { excludedAt: new Date() },
        }))
      }
      ops.push(prisma.task.deleteMany({ where: { interviewId: id, NOT: { id: { in: keep.length ? keep : ['__none__'] } } } }))
      tasks.forEach((t, index) => {
        const order = index + 1
        const hint = t.hint?.trim() ? t.hint.trim() : null
        const isPrerequisite = t.isPrerequisite === true
        if (t.id && ownTaskIds.has(t.id)) {
          ops.push(prisma.task.update({ where: { id: t.id }, data: { text: t.text, order, hint, isPrerequisite } }))
        } else {
          ops.push(prisma.task.create({ data: { interviewId: id, text: t.text, order, hint, isPrerequisite } }))
        }
      })
    }

    if (screeners) {
      const ownScreenerIds = new Set(existing.screeners.map((x) => x.id))
      const keep = screeners.map((x) => (x.id && ownScreenerIds.has(x.id) ? x.id : null)).filter(Boolean) as string[]
      ops.push(prisma.screenerQuestion.deleteMany({ where: { interviewId: id, NOT: { id: { in: keep.length ? keep : ['__none__'] } } } }))
      screeners.forEach((x, index) => {
        const order = index + 1
        // disqualify は options の中の値だけを採用する
        const disqualify = x.disqualify.filter((d) => x.options.includes(d))
        const payload = { label: x.label, options: x.options, disqualify, required: x.required, order }
        if (x.id && ownScreenerIds.has(x.id)) {
          ops.push(prisma.screenerQuestion.update({ where: { id: x.id }, data: payload }))
        } else {
          ops.push(prisma.screenerQuestion.create({ data: { interviewId: id, ...payload } }))
        }
      })
    }

    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description || null
    if (stimulusUrl !== undefined) data.stimulusUrl = stimulusUrl || null
    if (stimulusDuration !== undefined) data.stimulusDuration = stimulusDuration
    if (seqEnabled !== undefined) data.seqEnabled = seqEnabled
    if (hintDelaySec !== undefined) data.hintDelaySec = hintDelaySec
    if (Object.keys(data).length > 0) {
      ops.push(prisma.interview.update({ where: { id }, data }))
    }

    if (ops.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }
    await prisma.$transaction(ops)

    const updated = await prisma.interview.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } }, tasks: { orderBy: { order: 'asc' } }, screeners: { orderBy: { order: 'asc' } } },
    })
    return NextResponse.json(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    // 配下の全セッション（被験者の録画・発言を含む）が消える。編集者より上の権限を要求する
    const { orgId } = await requireRole('admin')
    const { id } = await props.params
    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, sessions: { select: { recordingUrl: true } } },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 録画は Blob ストレージにあり、DB のカスケード削除では消えない。
    // 先に消さないと、参加者の録画が誰からも参照できないまま保管され続ける。
    // 1件でも失敗したら中断する（DB を消してしまうと URL が分からなくなり、二度と消せない）。
    const urls = interview.sessions.map((s) => s.recordingUrl).filter((u): u is string => !!u)
    for (const url of urls) {
      try {
        await del(url)
      } catch (e) {
        console.error('Blob deletion failed (aborting interview delete):', e)
        return NextResponse.json(
          { error: '録画データの削除に失敗したため、中断しました。時間をおいて再度お試しください。' },
          { status: 502 }
        )
      }
    }

    await prisma.interview.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
