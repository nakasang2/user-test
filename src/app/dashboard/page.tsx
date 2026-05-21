'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import CreateInterviewModal from '@/components/CreateInterviewModal'
import CreateSessionModal from '@/components/CreateSessionModal'
import AgentChat from '@/components/AgentChat'

interface Question {
  id: string
  text: string
  order: number
  type: string
}

interface Interview {
  id: string
  title: string
  description: string | null
  questions: Question[]
  _count: { sessions: number }
  createdAt: string
}

interface Session {
  id: string
  status: string
  dailyRoomName: string   // Feature 2: URL再確認用
  dailyRoomUrl: string
  createdAt: string
  interview: { title: string }
  participant: { name: string } | null
  transcript: { summary: string | null } | null
  _count: { emotions: number }
}

export default function Dashboard() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showCreateInterview, setShowCreateInterview] = useState(false)
  const [showCreateSession, setShowCreateSession] = useState(false)
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'sessions' | 'interviews'>('sessions')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [iv, sv] = await Promise.all([
      fetch('/api/interviews').then((r) => r.json()),
      fetch('/api/sessions').then((r) => r.json()),
    ])
    setInterviews(iv)
    setSessions(sv)
  }

  // URL コピー
  async function copyInterviewUrl(session: Session, e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}/interview/${session.dailyRoomName}`
    await navigator.clipboard.writeText(url)
    setCopiedId(session.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // セッション削除（Blob動画 + DB）
  async function deleteSession(id: string, e: React.MouseEvent) {
    e.preventDefault()
    setDeletingId(id)
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold text-indigo-400">UserVoice</Link>
          <span className="text-gray-500">/</span>
          <span className="text-gray-300">ダッシュボード</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateInterview(true)}
            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + インタビュー作成
          </button>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              window.location.href = '/login'
            }}
            className="border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="ログアウト"
          >
            ログアウト
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-3 gap-6 mb-8">
          <StatCard value={interviews.length} label="インタビューテンプレート" />
          <StatCard value={sessions.length} label="総セッション数" />
          <StatCard value={sessions.filter((s) => s.status === 'done').length} label="分析完了" />
        </div>

        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-2">
            <div className="flex gap-2 mb-4">
              <TabButton active={activeTab === 'sessions'} onClick={() => setActiveTab('sessions')}>
                セッション ({sessions.length})
              </TabButton>
              <TabButton active={activeTab === 'interviews'} onClick={() => setActiveTab('interviews')}>
                インタビューテンプレート ({interviews.length})
              </TabButton>
            </div>

            {activeTab === 'sessions' && (
              <div className="space-y-3">
                {sessions.length === 0 ? (
                  <EmptyState message="セッションがありません。インタビューを作成してセッションを開始しましょう。" />
                ) : (
                  sessions.map((s) => (
                    <div key={s.id} className="relative group">
                      <Link
                        href={`/dashboard/sessions/${s.id}`}
                        className="block p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-indigo-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{s.participant?.name ?? 'Anonymous'}</span>
                            <span className="text-gray-500 mx-2">·</span>
                            <span className="text-gray-400 text-sm">{s.interview.title}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <StatusBadge status={s.status} />
                          </div>
                        </div>
                        {s.transcript?.summary && (
                          <p className="mt-2 text-sm text-gray-400 line-clamp-2">{s.transcript.summary}</p>
                        )}
                        <div className="mt-2 text-xs text-gray-600">
                          {new Date(s.createdAt).toLocaleDateString('ja-JP')}
                        </div>
                      </Link>

                      {/* URL コピーボタン（未完了セッションのみ） */}
                      {(s.status === 'pending' || s.status === 'active') && (
                        <button
                          onClick={(e) => copyInterviewUrl(s, e)}
                          className="absolute top-3 right-3 bg-gray-800 hover:bg-indigo-700 border border-gray-700 px-2.5 py-1 rounded-lg text-xs text-gray-300 hover:text-white transition-colors"
                        >
                          {copiedId === s.id ? '✓ コピー済み' : '🔗 URL コピー'}
                        </button>
                      )}

                      {/* 削除ボタン（完了済みセッション） */}
                      {(s.status === 'done' || s.status === 'completed') && (
                        confirmDeleteId === s.id ? (
                          // 確認UI
                          <div
                            className="absolute top-3 right-3 flex items-center gap-1.5"
                            onClick={(e) => e.preventDefault()}
                          >
                            <span className="text-xs text-gray-400">削除しますか？</span>
                            <button
                              onClick={(e) => deleteSession(s.id, e)}
                              disabled={deletingId === s.id}
                              className="bg-red-700 hover:bg-red-600 disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs text-white transition-colors"
                            >
                              {deletingId === s.id ? '削除中...' : '削除'}
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); setConfirmDeleteId(null) }}
                              className="bg-gray-700 hover:bg-gray-600 px-2.5 py-1 rounded-lg text-xs text-gray-300 transition-colors"
                            >
                              キャンセル
                            </button>
                          </div>
                        ) : (
                          // ゴミ箱アイコン
                          <button
                            onClick={(e) => { e.preventDefault(); setConfirmDeleteId(s.id) }}
                            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 bg-gray-800 hover:bg-red-900 border border-gray-700 hover:border-red-700 p-1.5 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                            title="セッションを削除"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        )
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'interviews' && (
              <div className="space-y-3">
                {interviews.length === 0 ? (
                  <EmptyState message="インタビューテンプレートがありません。作成してください。" />
                ) : (
                  interviews.map((iv) => (
                    <div key={iv.id} className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">{iv.title}</h3>
                        <div className="flex gap-2">
                          {/* 比較ビューリンク（Feature 3） */}
                          {iv._count.sessions > 0 && (
                            <Link
                              href={`/dashboard/interviews/${iv.id}`}
                              className="border border-gray-700 hover:border-indigo-500 px-3 py-1 rounded-lg text-xs text-gray-400 hover:text-indigo-400 transition-colors"
                            >
                              比較ビュー
                            </Link>
                          )}
                          <button
                            onClick={() => { setSelectedInterviewId(iv.id); setShowCreateSession(true) }}
                            className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                          >
                            セッション作成
                          </button>
                        </div>
                      </div>
                      {iv.description && (
                        <p className="text-gray-400 text-sm mb-2">{iv.description}</p>
                      )}
                      <div className="text-xs text-gray-500 mb-2">
                        {iv.questions.length} 質問 · {iv._count.sessions} セッション
                      </div>
                      <div className="space-y-1">
                        {iv.questions.slice(0, 3).map((q) => (
                          <div key={q.id} className="text-xs text-gray-500 flex gap-2 items-center">
                            <span className="text-gray-700">{q.order}.</span>
                            {q.type !== 'open' && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                q.type === 'nps' ? 'bg-green-900/50 text-green-400' : 'bg-blue-900/50 text-blue-400'
                              }`}>
                                {q.type === 'nps' ? 'NPS' : '評価'}
                              </span>
                            )}
                            <span className="line-clamp-1">{q.text}</span>
                          </div>
                        ))}
                        {iv.questions.length > 3 && (
                          <div className="text-xs text-gray-600">+{iv.questions.length - 3} more...</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            <h2 className="font-semibold mb-4 text-gray-300">AI アシスタント</h2>
            <AgentChat />
          </div>
        </div>
      </div>

      {showCreateInterview && (
        <CreateInterviewModal
          onClose={() => setShowCreateInterview(false)}
          onCreated={() => { fetchData(); setShowCreateInterview(false) }}
        />
      )}

      {showCreateSession && selectedInterviewId && (
        <CreateSessionModal
          interviewId={selectedInterviewId}
          onClose={() => setShowCreateSession(false)}
          onCreated={async (session: { joinUrl?: string; dailyRoomUrl?: string }) => {
            const url = session.joinUrl ?? session.dailyRoomUrl ?? ''
            await navigator.clipboard.writeText(url)
            fetchData()
            setShowCreateSession(false)
          }}
        />
      )}
    </div>
  )
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="text-3xl font-bold text-indigo-400 mb-1">{value}</div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
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
    pending: '待機中', active: '進行中', completed: '完了', processing: '処理中', done: '分析済み',
  }
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-700 text-gray-400'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-8 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
      {message}
    </div>
  )
}
