import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateInterviewQuestions } from '@/lib/ai'

export async function GET() {
  const interviews = await prisma.interview.findMany({
    include: {
      questions: { orderBy: { order: 'asc' } },
      _count: { select: { sessions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(interviews)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, description, questions, autoGenerate, topic } = body

  // questions は { text, type } オブジェクト配列 or 文字列配列（AI 生成時）の両方に対応
  type QuestionInput = { text: string; type?: string } | string
  let questionList: QuestionInput[] = questions ?? []

  if (autoGenerate && topic) {
    const generated = await generateInterviewQuestions(topic, 5)
    questionList = generated.map((text) => ({ text, type: 'open' }))
  }

  const interview = await prisma.interview.create({
    data: {
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
}
