import Link from 'next/link'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const [interviewCount, sessionCount] = await Promise.all([
    prisma.interview.count(),
    prisma.session.count(),
  ])

  const recentSessions = await prisma.session.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { interview: { select: { title: true } }, participant: true },
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-indigo-400">UserVoice</span>
          <span className="text-gray-500 text-sm">Auto Interview</span>
        </div>
        <Link href="/dashboard" className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          ダッシュボード
        </Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">
            ユーザーインタビューを
            <span className="text-indigo-400"> 自動化</span>
          </h1>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto">
            インタビュアー不在でビデオインタビューを実施。AI が質問を進行し、
            表情・発言を分析してインサイトを自動生成します。
          </p>
          <div className="mt-8 flex gap-4 justify-center">
            <Link href="/dashboard" className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-xl font-semibold transition-colors">
              はじめる
            </Link>
            <Link href="/dashboard" className="border border-gray-700 hover:border-gray-500 px-6 py-3 rounded-xl font-semibold transition-colors">
              インタビューを作成
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-16">
          <StatCard value={interviewCount} label="インタビューテンプレート" />
          <StatCard value={sessionCount} label="実施済みセッション" />
          <StatCard value={recentSessions.filter((s) => s.status === 'done').length} label="分析完了" />
        </div>

        <div className="grid grid-cols-3 gap-6 mb-16">
          <FeatureCard icon="🎥" title="ビデオ会議" desc="URLを送るだけ。被験者がブラウザで参加できます" />
          <FeatureCard icon="🤖" title="AI インタビュアー" desc="設定した質問を AI が自動で進行。自然な流れで深掘り" />
          <FeatureCard icon="😊" title="表情・感情分析" desc="インタビュー中の表情をリアルタイムで解析・記録" />
          <FeatureCard icon="📝" title="自動文字起こし" desc="Whisper で高精度な文字起こし。話者も識別" />
          <FeatureCard icon="📊" title="ダッシュボード" desc="被験者ごとに結果を一覧。比較・分析が簡単" />
          <FeatureCard icon="💬" title="AI エージェント" desc="「どのユーザーが最も困惑した？」などと質問するだけ" />
        </div>

        {recentSessions.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4 text-gray-300">最近のセッション</h2>
            <div className="space-y-2">
              {recentSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/dashboard/sessions/${s.id}`}
                  className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-indigo-700 transition-colors"
                >
                  <div>
                    <span className="font-medium">{s.participant?.name ?? 'Anonymous'}</span>
                    <span className="text-gray-500 mx-2">·</span>
                    <span className="text-gray-400 text-sm">{s.interview.title}</span>
                  </div>
                  <StatusBadge status={s.status} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
      <div className="text-4xl font-bold text-indigo-400 mb-1">{value}</div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-gray-400 text-sm">{desc}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    active: 'bg-green-500/20 text-green-400',
    completed: 'bg-blue-500/20 text-blue-400',
    processing: 'bg-purple-500/20 text-purple-400',
    done: 'bg-indigo-500/20 text-indigo-400',
  }
  const labels: Record<string, string> = {
    pending: '待機中',
    active: '進行中',
    completed: '完了',
    processing: '処理中',
    done: '分析済み',
  }
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-700 text-gray-400'}`}>
      {labels[status] ?? status}
    </span>
  )
}
