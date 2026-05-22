import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { generateInterviewQuestions } from '@/lib/ai'
import { requireAuth, handleApiError } from '@/lib/api-auth'

const createSchema = z.object({
  title:        z.string().min(1, 'タイトルを入力してください').max(200),
  description:  z.string().max(1000).optional(),
  autoGenerate: z.boolean().optional(),
  topic:        z.string().max(500).optional(),
  questions:    z.array(z.union([
    z.string(),
    z.object({ text: z.string(), type: z.string().optional() }),
  ])).optional(),
})

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const interviews = await prisma.interview.findMany({
      where: { organizationId: orgId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        _count: { select: { sessions: true } },
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
    const { title, description, questions, autoGenerate, topic } = parsed.data

    type QuestionInput = { text: string; type?: string } | string
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
        questions: {
          create: questionList.map((q: QuestionInput, index: number) => ({
            text: typeof q === 'string' ? q : q.text,
            type: typeof q === 'string' ? 'open' : (q.type ?? 'open'),
            order: index + 1,
          })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    })

    return NextResponse.json(interview, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
