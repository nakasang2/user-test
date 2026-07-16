import Link from 'next/link'
import { prisma } from '@/lib/db'
import StatusBadge from '@/components/StatusBadge'
import {
  Video,
  Sparkles,
  SmilePlus,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  ArrowRight,
} from 'lucide-react'

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
    <main className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight">UserVoice</span>
          <span className="text-gray-400 text-xs">·  Auto Interview</span>
        </div>
        <Link
          href="/dashboard"
          className="bg-gray-900 hover:bg-gray-800 text-white px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors"
        >
          ダッシュボード
        </Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-20">
          <h1 className="text-5xl font-semibold tracking-tight mb-5 text-gray-900">
            ユーザーインタビューを、<br />
            <span className="text-gray-400">自動化する。</span>
          </h1>
          <p className="text-gray-600 text-lg max-w-xl mx-auto leading-relaxed">
            インタビュアー不在でビデオインタビューを実施。AI が質問を進行し、
            表情・発言を分析してインサイトを自動生成します。
          </p>
          <div className="mt-10 flex gap-3 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-5 py-2.5 rounded-md font-medium text-sm transition-colors"
            >
              はじめる
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center bg-white border border-gray-300 hover:border-gray-400 text-gray-700 px-5 py-2.5 rounded-md font-medium text-sm transition-colors"
            >
              ログイン
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-20">
          <StatCard value={interviewCount} label="インタビューテンプレート" />
          <StatCard value={sessionCount} label="実施済みセッション" />
          <StatCard
            value={recentSessions.filter((s) => s.status === 'done').length}
            label="分析完了"
          />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-20">
          <FeatureCard
            icon={<Video className="w-5 h-5" strokeWidth={1.5} />}
            title="ビデオ会議"
            desc="URLを送るだけ。被験者がブラウザで参加できます"
          />
          <FeatureCard
            icon={<Sparkles className="w-5 h-5" strokeWidth={1.5} />}
            title="AI インタビュアー"
            desc="設定した質問を AI が自動で進行。自然な流れで深掘り"
          />
          <FeatureCard
            icon={<SmilePlus className="w-5 h-5" strokeWidth={1.5} />}
            title="表情エンゲージメント指標"
            desc="インタビュー中の表情から参考指標をリアルタイム記録（補助シグナル）"
          />
          <FeatureCard
            icon={<FileText className="w-5 h-5" strokeWidth={1.5} />}
            title="自動文字起こし"
            desc="ブラウザ音声認識でリアルタイムに文字起こし"
          />
          <FeatureCard
            icon={<LayoutDashboard className="w-5 h-5" strokeWidth={1.5} />}
            title="ダッシュボード"
            desc="被験者ごとに結果を一覧。比較・分析が簡単"
          />
          <FeatureCard
            icon={<MessagesSquare className="w-5 h-5" strokeWidth={1.5} />}
            title="AI エージェント"
            desc="「どのユーザーが最も困惑した？」などと質問するだけ"
          />
        </div>

        {recentSessions.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              最近のセッション
            </h2>
            <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
              {recentSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/dashboard/sessions/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">{s.participant?.name ?? 'Anonymous'}</span>
                    <span className="text-gray-300 mx-2">·</span>
                    <span className="text-gray-500 text-sm">{s.interview.title}</span>
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
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="text-3xl font-semibold text-gray-900 mb-0.5 tracking-tight">{value}</div>
      <div className="text-gray-500 text-xs">{label}</div>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors">
      <div className="w-9 h-9 rounded-md bg-gray-100 text-gray-700 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-medium text-sm text-gray-900 mb-1">{title}</h3>
      <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
    </div>
  )
}
