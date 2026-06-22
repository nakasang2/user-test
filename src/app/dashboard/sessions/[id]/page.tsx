'use client'

import { useState, useEffect, use, useRef } from 'react'
import Link from 'next/link'
import EmotionChart from '@/components/EmotionChart'
import TranscriptView from '@/components/TranscriptView'
import FloatingAgentChat from '@/components/FloatingAgentChat'
import StatusBadge from '@/components/StatusBadge'
import { Video, Download, X, Folder } from 'lucide-react'

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
  dailyRoomName: string
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
  const [processing, setProcessing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null)
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // 録画は非公開 Blob のため、認可済みエンドポイント経由で短命の署名付き URL を取得する
  useEffect(() => {
    if (!session?.recordingUrl) return
    let cancelled = false
    fetch(`/api/sessions/${id}/recording`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.url) setSignedVideoUrl(data.url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id, session?.recordingUrl])

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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    )
  }

  const roomLink = `/interview/${session.dailyRoomName}`

  // 録画は非公開 Blob。署名付き URL を取得できた場合のみ再生・ダウンロード可能とする
  const serverVideoUrl = signedVideoUrl
  const videoSrc = localVideoUrl ?? serverVideoUrl ?? null

  const actionButton = (() => {
    if (session.status === 'processing') {
      return <span className="text-gray-700 text-sm animate-pulse">AI 分析中...</span>
    }
    if (session.status === 'done' && session.transcript) {
      return (
        <button
          onClick={reanalyze}
          disabled={processing}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 disabled:opacity-50 px-4 py-2 rounded-md text-sm transition-colors"
        >
          {processing ? '再分析中...' : 'AI 再分析'}
        </button>
      )
    }
    return null
  })()

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ナビ */}
      <nav className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="text-gray-700 hover:text-gray-900">UserVoice</Link>
          <span className="text-gray-300">/</span>
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-900">ダッシュボード</Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900">{session.participant?.name ?? 'Anonymous'}</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={session.status} />
          {session.transcript && (
            <button
              onClick={exportCsv}
              className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs transition-colors"
            >
              CSV 出力
            </button>
          )}
          {actionButton}
          <Link
            href={roomLink}
            className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            インタビュールームを開く
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 pb-24">
        {/* ヒーロー */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 mb-1">
            {session.participant?.name ?? 'Anonymous'}
          </h1>
          <p className="text-sm text-gray-500">
            {session.interview.title} · {new Date(session.createdAt).toLocaleDateString('ja-JP')}
          </p>
        </div>

        {/* インタビュー未完了の案内 */}
        {(session.status === 'pending' || session.status === 'active') && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
            <p className="text-amber-700 text-sm">
              インタビューがまだ完了していません。被験者に上のボタンの URL を共有してください。
            </p>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}${roomLink}`)
                alert('インタビュー URL をコピーしました')
              }}
              className="ml-4 flex-shrink-0 bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              URL をコピー
            </button>
          </div>
        )}

        {/* 録画バナー */}
        {serverVideoUrl && (
          <div className="mb-6 flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
            <span className="text-sm text-gray-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              録画データあり — 右カラムの感情グラフと同期して確認できます
            </span>
            <a
              href={serverVideoUrl}
              download={`interview-${session.participant?.name ?? 'anonymous'}.webm`}
              className="text-xs text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3 h-3" strokeWidth={2} />
              ダウンロード
            </a>
          </div>
        )}

        {/* ── メインコンテンツ 2カラム ── */}
        <div className="grid grid-cols-2 gap-6 items-start">

          {/* 左: 文字起こし */}
          <div>
            <SectionLabel>文字起こし</SectionLabel>
            <TranscriptView
              transcript={session.transcript}
              questions={session.interview.questions}
            />
          </div>

          {/* 右: 表情エンゲージメント指標 + 動画 */}
          <div>
            <SectionLabel>表情エンゲージメント指標（参考）</SectionLabel>

            {/* 動画プレーヤー or ファイルピッカー */}
            {videoSrc ? (
              <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    グラフをクリック → その時刻にジャンプ · 再生位置がグラフに反映されます
                  </p>
                  <button
                    onClick={clearLocalVideo}
                    className="text-xs text-gray-500 hover:text-gray-900 transition-colors ml-4 flex-shrink-0 flex items-center gap-1"
                  >
                    <X className="w-3 h-3" strokeWidth={2} />
                    別のファイル
                  </button>
                </div>
                <video
                  ref={videoRef}
                  controls
                  src={videoSrc}
                  onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                  onError={clearLocalVideo}
                  className="w-full bg-black"
                  style={{ maxHeight: '320px' }}
                />
              </div>
            ) : (
              <div className="mb-4 bg-gray-50 border border-gray-200 border-dashed rounded-lg p-6 text-center">
                <Video className="w-5 h-5 text-gray-400 mx-auto mb-3" strokeWidth={1.75} />
                <p className="text-sm text-gray-900 font-medium mb-1">
                  録画ファイルを読み込むと感情グラフと同期できます
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  インタビュー終了時にダウンロードした{' '}
                  <span className="font-mono text-gray-700">interview-XXXXXXXX.webm</span>{' '}
                  を選択
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
                  className="bg-gray-900 hover:bg-gray-800 text-white px-5 py-2 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Folder className="w-3.5 h-3.5" strokeWidth={2} />
                  録画ファイルを選択
                </button>
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
        </div>
      </div>

      {/* フローティング AI チャット */}
      <FloatingAgentChat sessionId={session.id} />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">
      {children}
    </div>
  )
}
