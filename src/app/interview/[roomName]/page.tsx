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
      participantToken={session.participantToken ?? undefined}
      roomName={roomName}
      questions={session.interview.questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: (('type' in q ? q.type : undefined) ?? 'open') as 'open' | 'rating' | 'nps',
        // 印象テストで質問ごとに提示する画像。ここで渡し忘れると、設定しても参加者側に出ない
        imageUrl: q.imageUrl,
        imageMode: q.imageMode,
        imageDuration: q.imageDuration,
      }))}
      interviewTitle={session.interview.title}
      participantName={session.participant?.name}
      interviewType={session.interview.type as 'interview' | 'impression' | 'usability'}
      usabilityMode={(session.interview.usabilityMode as 'prototype' | 'service' | null | undefined) ?? undefined}
      stimulusUrl={session.interview.stimulusUrl ?? undefined}
      stimulusDuration={session.interview.stimulusDuration ?? undefined}
      tasks={session.interview.tasks}
      seqEnabled={session.interview.seqEnabled}
      hintDelaySec={session.interview.hintDelaySec ?? undefined}
    />
  )
}
