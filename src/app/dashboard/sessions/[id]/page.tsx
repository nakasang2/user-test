'use client'

import { useState, useEffect, use, useRef } from 'react'
import Link from 'next/link'
import AgentChat from '@/components/AgentChat'
import EmotionChart from '@/components/EmotionChart'
import TranscriptView from '@/components/TranscriptView'

interface Segment {
  id: string
  speaker: string
  text: string
  startTime: number
  endTime: number
  sentiment: string | null
}

interface Transcript {
  fullText: string
  summary: string | null
  themes: string | null
  segments: Segment[]
}

interface EmotionResult {
  timestamp: number
  happy: number
  sad: number
  angry: number
  fearful: number
  disgusted: number
  surprised: number
  neutral: number
}

interface Session {
  id: string
  status: string
  dailyRoomName: string   // Bug fix #2: URLではなくroomNameを使う
  dailyRoomUrl: string
  recordingUrl: string | null
  createdAt: string
  interview: {
    id: string
    title: string
    questions: { id: string; text: string; order: number }[]
  }
  participant: { name: string; email: string | null } | null
  transcript: Transcript | null
  emotions: EmotionResult[]
}

export default function SessionDetail(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params)
  const [session, setSession] = useState<Session | null>(null)
  const [activeTab, setActiveTab] = useState<'transcript' | 'emotions' | 'agent'>('transcript')
  const [processing, setProcessing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // アンマウント時に Object URL を解放
  const localVideoUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => { if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current) }
  }, [])

  function handleLocalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current)
    const url = URL.createObjectURL(file)
    localVideoUrlRef.current = url
    setLocalVideoUrl(url)
    setVideoCurrentTime(0)
  }

  function clearLocalVideo() {
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current)
    localVideoUrlRef.current = null
    setLocalVideoUrl(null)
    setVideoCurrentTime(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then(setSession)
  }, [id])

  // Feature 4: CSV エクスポート
  function exportCsv() {
    if (!session) return
    const rows: string[][] = [
      ['speaker', 'text', 'startTime', 'endTime', 'sentiment'],
      ...(session.transcript?.segments.map((s) => [
        s.speaker, `"${s.text.replace(/"/g, '""')}"`,
        String(s.startTime), String(s.endTime), s.sentiment ?? '',
      ]) ?? []),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `interview_${session.participant?.name ?? 'anonymous'}_${session.id.slice(0, 6)}.csv`
    a.click()
  }

  // Bug fix #3: モックデータを廃止。completed 状態のセッションに対して
  // インタビューで収集した実データを再分析するだけに変更。
  async function reanalyze() {
    if (!session?.transcript) return
    setProcessing(true)
    try {
      await fetch(`/api/sessions/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: session.transcript.fullText,
          segments: session.transcript.segments.map((s) => ({
            speaker: s.speaker,
            text: s.text,
            start: s.startTime,
            end: s.endTime,
          })),
          emotions: session.emotions,
        }),
      })
      const updated = await fetch(`/api/sessions/${id}`).then((r) => r.json())
      setSession(updated)
    } finally {
      setProcessing(false)
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    )
  }

  // インタビュールームへのリンク: roomName を直接使用（Bug fix #2）
  const roomLink = `/interview/${session.dailyRoomName}`

  // ステータスに応じたアクションボタン
  const actionButton = (() => {
    if (session.status === 'processing') {
      return (
        <span className="text-purple-400 text-sm animate-pulse">AI 分析中...</span>
      )
    }
    // 分析済みで transcript がある → 再分析ボタン
    if (session.status === 'done' && session.transcript) {
      return (
        <button
          onClick={reanalyze}
          disabled={processing}
          className="border border-gray-600 hover:border-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-indigo-400 transition-colors"
        >
          {processing ? '再分析中...' : 'AI 再分析'}
        </button>
      )
    }
    // インタビュー未完了（pending / active）→ インタビュールームへ誘導
    if (session.status === 'pending' || session.status === 'active') {
      return (
        <span className="text-yellow-400 text-sm">インタビュー未完了</span>
      )
    }
    return null
  })()

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="text-indigo-400 hover:text-indigo-300">UserVoice</Link>
          <span className="text-gray-600">/</span>
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-300">ダッシュボード</Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-300">{session.participant?.name ?? 'Anonymous'}</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={session.status} />
          {/* Feature 4: CSV エクスポートボタン */}
          {session.transcript && (
            <button
              onClick={exportCsv}
              className="border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              CSV 出力
            </button>
          )}
          {actionButton}
          {/* Bug fix #2: dailyRoomName を直接使用 */}
          <Link
            href={roomLink}
            className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            インタビュールームを開く
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">
            {session.participant?.name ?? 'Anonymous'}
          </h1>
          <p className="text-gray-400">
            {session.interview.title} · {new Date(session.createdAt).toLocaleDateString('ja-JP')}
          </p>
        </div>

        {session.transcript && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <SummaryCard title="サマリー" content={session.transcript.summary ?? '分析中'} />
            <SummaryCard title="主要テーマ" content={session.transcript.themes ?? 'N/A'} />
            <SummaryCard
              title="感情データ"
              content={session.emotions.length > 0
                ? `${session.emotions.length} サンプル取得済み`
                : 'データなし'}
            />
          </div>
        )}

        {/* 録画ありの場合：感情タブへの誘導バナー */}
        {session.recordingUrl && (
          <div className="mb-6 flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <span className="text-sm text-gray-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              録画データあり —
              <button
                onClick={() => setActiveTab('emotions')}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
              >
                感情タブで動画と同期して確認
              </button>
            </span>
            <a
              href={session.recordingUrl}
              download={`interview-${session.participant?.name ?? 'anonymous'}.webm`}
              className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ ダウンロード
            </a>
          </div>
        )}

        {/* インタビュー未完了の案内 */}
        {(session.status === 'pending' || session.status === 'active') && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-800 rounded-xl flex items-center justify-between">
            <p className="text-yellow-300 text-sm">
              インタビューがまだ完了していません。被験者に上のボタンのURLを共有してください。
            </p>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${window.location.origin}${roomLink}`
                )
                alert('インタビューURLをコピーしました')
              }}
              className="ml-4 flex-shrink-0 bg-yellow-600 hover:bg-yellow-500 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              URLをコピー
            </button>
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <TabButton active={activeTab === 'transcript'} onClick={() => setActiveTab('transcript')}>
            文字起こし
          </TabButton>
          <TabButton active={activeTab === 'emotions'} onClick={() => setActiveTab('emotions')}>
            感情分析 {session.emotions.length > 0 && `(${session.emotions.length})`}
          </TabButton>
          <TabButton active={activeTab === 'agent'} onClick={() => setActiveTab('agent')}>
            AI に質問
          </TabButton>
        </div>

        {activeTab === 'transcript' && (
          <TranscriptView
            transcript={session.transcript}
            questions={session.interview.questions}
          />
        )}
        {activeTab === 'emotions' && (() => {
          // ローカルファイル優先、なければサーバー URL、どちらもなければ null
          const videoSrc = localVideoUrl ?? session.recordingUrl ?? null
          return (
            <div>
              {/* 動画なし → ファイルピッカー */}
              {!videoSrc && (
                <div className="mb-6 bg-gray-900 border border-gray-800 border-dashed rounded-xl p-8 text-center">
                  <div className="text-3xl mb-3">🎬</div>
                  <p className="text-sm text-gray-300 font-medium mb-1">
                    録画ファイルを読み込むと感情グラフと同期できます
                  </p>
                  <p className="text-xs text-gray-600 mb-5">
                    インタビュー終了時に自動ダウンロードされた{' '}
                    <span className="text-gray-500 font-mono">interview-XXXXXXXX.webm</span>{' '}
                    を選択してください
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/webm,audio/webm,.webm"
                    onChange={handleLocalFile}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    📂 録画ファイルを選択
                  </button>
                </div>
              )}

              {/* 動画あり → プレーヤー */}
              {videoSrc && (
                <div className="mb-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      グラフをクリックするとその時刻にジャンプ ·
                      動画の再生位置がグラフ上の縦線で表示されます
                    </p>
                    {localVideoUrl && (
                      <button
                        onClick={clearLocalVideo}
                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors ml-4 flex-shrink-0"
                      >
                        × ファイルを変更
                      </button>
                    )}
                  </div>
                  <video
                    ref={videoRef}
                    controls
                    src={videoSrc}
                    onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                    className="w-full bg-black"
                    style={{ maxHeight: '400px' }}
                  />
                </div>
              )}

              <EmotionChart
                emotions={session.emotions}
                currentTime={videoSrc ? videoCurrentTime : undefined}
                onSeek={videoSrc ? (ts) => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = ts
                    videoRef.current.play()
                  }
                } : undefined}
              />
            </div>
          )
        })()}
        {activeTab === 'agent' && (
          <div className="max-w-2xl">
            <AgentChat sessionId={session.id} />
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ title, content }: { title: string; content: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      <p className="text-sm text-gray-300">{content}</p>
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
