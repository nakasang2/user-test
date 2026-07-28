import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAuth, requireRole, handleApiError } from '@/lib/api-auth'

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
  // id 付き = 既存を更新（過去の回答との紐づけを保つ）、id 無し = 新規追加。
  // 送られてこなかった既存項目は削除される。
  questions: z.array(z.object({
    id:   z.string().optional(),
    text: z.string().min(1).max(2000),
    type: z.enum(['open', 'rating', 'nps']).default('open'),
  })).optional(),
  tasks: z.array(z.object({
    id:   z.string().optional(),
    text: z.string().min(1).max(2000),
  })).optional(),
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
      select: { id: true, questions: { select: { id: true } }, tasks: { select: { id: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
    }
    const { title, description, stimulusUrl, stimulusDuration, questions, tasks } = parsed.data

    // 他インタビューの id を送られても触らないよう、自分の配下だけを対象にする
    const ownQuestionIds = new Set(existing.questions.map((q) => q.id))
    const ownTaskIds = new Set(existing.tasks.map((t) => t.id))

    const ops = []

    if (questions) {
      const keep = questions.map((q) => (q.id && ownQuestionIds.has(q.id) ? q.id : null)).filter(Boolean) as string[]
      ops.push(prisma.question.deleteMany({ where: { interviewId: id, NOT: { id: { in: keep.length ? keep : ['__none__'] } } } }))
      questions.forEach((q, index) => {
        const order = index + 1
        if (q.id && ownQuestionIds.has(q.id)) {
          ops.push(prisma.question.update({ where: { id: q.id }, data: { text: q.text, type: q.type, order } }))
        } else {
          ops.push(prisma.question.create({ data: { interviewId: id, text: q.text, type: q.type, order } }))
        }
      })
    }

    if (tasks) {
      const keep = tasks.map((t) => (t.id && ownTaskIds.has(t.id) ? t.id : null)).filter(Boolean) as string[]
      ops.push(prisma.task.deleteMany({ where: { interviewId: id, NOT: { id: { in: keep.length ? keep : ['__none__'] } } } }))
      tasks.forEach((t, index) => {
        const order = index + 1
        if (t.id && ownTaskIds.has(t.id)) {
          ops.push(prisma.task.update({ where: { id: t.id }, data: { text: t.text, order } }))
        } else {
          ops.push(prisma.task.create({ data: { interviewId: id, text: t.text, order } }))
        }
      })
    }

    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description || null
    if (stimulusUrl !== undefined) data.stimulusUrl = stimulusUrl || null
    if (stimulusDuration !== undefined) data.stimulusDuration = stimulusDuration
    if (Object.keys(data).length > 0) {
      ops.push(prisma.interview.update({ where: { id }, data }))
    }

    if (ops.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }
    await prisma.$transaction(ops)

    const updated = await prisma.interview.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } }, tasks: { orderBy: { order: 'asc' } } },
    })
    return NextResponse.json(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const interview = await prisma.interview.findFirst({ where: { id, organizationId: orgId } })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.interview.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
