import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import EmotionChart from '@/components/EmotionChart'
import TranscriptView from '@/components/TranscriptView'
import PrintButton from '@/components/PrintButton'

export const metadata = { title: '共有レポート | UserVoice' }

/**
 * 読み取り専用の共有レポート（認証不要・shareToken でアクセス）。
 * PII（メール）・録画・内部 URL は含めず、文字起こし・要約・表情指標のみを表示する。
 * 印刷（PDF 保存）にも対応。
 */
export default async function SharePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const session = await prisma.session.findUnique({
    where: { shareToken: token },
    select: {
      status: true,
      createdAt: true,
      participant: { select: { name: true } },
      interview: {
        select: {
          title: true,
          questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, order: true } },
        },
      },
      transcript: {
        select: {
          fullText: true,
          summary: true,
          themes: true,
          segments: {
            orderBy: { startTime: 'asc' },
            select: { id: true, speaker: true, text: true, startTime: true, endTime: true, sentiment: true },
          },
        },
      },
      emotions: { orderBy: { timestamp: 'asc' } },
    },
  })

  if (!session) notFound()

  // 分析がまだ完了していない共有レポートは、内部操作向けの空状態（「AI分析を実行」等）を
  // 外部閲覧者に見せず、中立的な「準備中」表示にする。
  const analysisReady = !!session.transcript

  if (!analysisReady) {
    return (
      <div className="min-h-screen bg-white text-gray-900">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <header className="mb-8">
            <p className="text-xs text-gray-500 mb-1">共有レポート（読み取り専用）</p>
            <h1 className="text-2xl font-semibold tracking-tight">{session.interview.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {session.participant?.name ?? 'Anonymous'} ·{' '}
              {new Date(session.createdAt).toLocaleDateString('ja-JP')}
            </p>
          </header>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-700 font-medium mb-1">このレポートはまだ準備中です</p>
            <p className="text-xs text-gray-500">分析が完了すると、文字起こしと表情指標が表示されます。しばらくしてから再度お開きください。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs text-gray-500 mb-1">共有レポート（読み取り専用）</p>
            <h1 className="text-2xl font-semibold tracking-tight">{session.interview.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {session.participant?.name ?? 'Anonymous'} ·{' '}
              {new Date(session.createdAt).toLocaleDateString('ja-JP')}
            </p>
          </div>
          <PrintButton />
        </header>

        <section className="mb-10">
          <TranscriptView
            transcript={session.transcript}
            questions={session.interview.questions}
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold tracking-tight text-gray-900 mb-3">表情エンゲージメント指標（参考）</h2>
          <EmotionChart emotions={session.emotions} />
        </section>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-xs text-gray-400">
          UserVoice で生成された共有レポートです。表情指標は表情推定ベースの補助シグナルであり、実際の感情とは異なる場合があります。
        </footer>
      </div>
    </div>
  )
}
