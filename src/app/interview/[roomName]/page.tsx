import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import InterviewRoom from '@/components/InterviewRoom'

export default async function InterviewPage(props: { params: Promise<{ roomName: string }> }) {
  const { roomName } = await props.params

  const session = await prisma.session.findUnique({
    where: { dailyRoomName: roomName },
    include: {
      interview: {
        include: {
          questions: { orderBy: { order: 'asc' } },
          tasks: { orderBy: { order: 'asc' } },
        },
      },
      participant: true,
    },
  })

  if (!session) notFound()

  return (
    <InterviewRoom
      sessionId={session.id}
      roomName={roomName}
      dailyRoomUrl={session.dailyRoomUrl}
      questions={session.interview.questions.map((q) => ({
        text: q.text,
        type: (('type' in q ? q.type : undefined) ?? 'open') as 'open' | 'rating' | 'nps',
      }))}
      interviewTitle={session.interview.title}
      participantName={session.participant?.name}
      interviewType={session.interview.type as 'interview' | 'impression' | 'prototype' | 'usability'}
      stimulusUrl={session.interview.stimulusUrl ?? undefined}
      stimulusDuration={session.interview.stimulusDuration ?? undefined}
      tasks={session.interview.tasks}
    />
  )
}
