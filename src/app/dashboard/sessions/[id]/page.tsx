'use client'

import { useState, useEffect, use, useRef } from 'react'
import Link from 'next/link'
import EmotionChart from '@/components/EmotionChart'
import TranscriptView from '@/components/TranscriptView'
import FloatingAgentChat from '@/components/FloatingAgentChat'
import StatusBadge from '@/components/StatusBadge'
import { Video, Download, X, Folder } from 'lucide-react'
import { track } from '@/lib/analytics'

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
  shareEnabled?: boolean
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
  const [transcribing, setTranscribing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null)
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null)
  const [videoLoadError, setVideoLoadError] = useState(false)
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
    setVideoLoadError(false)
    setVideoCurrentTime(0)
  }

  // 再生失敗時: ローカルファイルなら破棄、サーバー録画なら署名URLを破棄しエラー表示する
  function handleVideoError() {
    if (localVideoUrl) {
      clearLocalVideo()
    } else {
      setSignedVideoUrl(null)
      setVideoLoadError(true)
    }
  }

  function clearLocalVideo() {
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current)
    localVideoUrlRef.current = null
    setLocalVideoUrl(null)
    setVideoCurrentTime(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions/${id}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        if (!r.ok) throw new Error('failed')
        return r.json()
      })
      .then((d) => { if (!cancelled && d) setSession(d) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
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

  async function shareSession() {
    try {
      const res = await fetch(`/api/sessions/${id}/share`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      const { shareToken } = await res.json()
      const url = `${window.location.origin}/share/${shareToken}`
      await navigator.clipboard.writeText(url)
      track('report_shared', { sessionId: id })
      setSession((prev) => (prev ? { ...prev, shareEnabled: true } : prev))
      alert(`読み取り専用の共有リンクをコピーしました:\n${url}`)
    } catch {
      alert('共有リンクの発行に失敗しました')
    }
  }

  async function revokeShare() {
    if (!confirm('共有リンクを停止します。停止後、このリンクからは閲覧できなくなります。よろしいですか？')) return
    try {
      const res = await fetch(`/api/sessions/${id}/share`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setSession((prev) => (prev ? { ...prev, shareEnabled: false } : prev))
      alert('共有リンクを停止しました')
    } catch {
      alert('共有の停止に失敗しました')
    }
  }

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
      const res = await fetch(`/api/sessions/${id}/process`, {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'AI 再分析に失敗しました。時間をおいて再度お試しください。')
        return
      }
      const upRes = await fetch(`/api/sessions/${id}`)
      if (!upRes.ok) {
        alert('分析は完了しましたが、最新データの取得に失敗しました。ページを再読み込みしてください。')
        return
      }
      setSession(await upRes.json())
    } catch {
      alert('通信エラーで AI 再分析を実行できませんでした。')
    } finally {
      setProcessing(false)
    }
  }

  async function transcribeFromRecording() {
    setTranscribing(true)
    try {
      const res = await fetch(`/api/sessions/${id}/transcribe`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? '文字起こしに失敗しました')
        return
      }
      track('recording_transcribed', { sessionId: id })
      const updated = await fetch(`/api/sessions/${id}`).then((r) => r.json())
      setSession(updated)
    } finally {
      setTranscribing(false)
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        {loadError ? (
          <>
            <div className="text-gray-700 text-sm">データの読み込みに失敗しました。</div>
            <button
              onClick={() => window.location.reload()}
              className="border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors"
            >
              再試行
            </button>
          </>
        ) : (
          <div className="text-gray-500 text-sm">読み込み中...</div>
        )}
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
      <nav className="border-b border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-y-3 bg-white">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="text-gray-700 hover:text-gray-900">UserVoice</Link>
          <span className="text-gray-300">/</span>
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-900">ダッシュボード</Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900">{session.participant?.name ?? 'Anonymous'}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge status={session.status} />
          {session.transcript && (
            <>
              <button
                onClick={shareSession}
                title={session.shareEnabled ? '共有リンクをコピー（共有は有効中）' : '読み取り専用の共有リンクを発行'}
                className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs transition-colors"
              >
                {session.shareEnabled ? '共有リンクをコピー' : '共有リンク'}
              </button>
              {session.shareEnabled && (
                <button
                  onClick={revokeShare}
                  className="border border-red-200 hover:border-red-300 text-red-600 hover:text-red-700 px-3 py-2 rounded-md text-xs transition-colors"
                >
                  共有を停止
                </button>
              )}
              <button
                onClick={exportCsv}
                className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs transition-colors"
              >
                CSV 出力
              </button>
            </>
          )}
          {session.recordingUrl && (
            <button
              onClick={transcribeFromRecording}
              disabled={transcribing}
              title="録画から Whisper で高精度に文字起こしします（話者識別は非対応）"
              className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 disabled:opacity-50 px-3 py-2 rounded-md text-xs transition-colors"
            >
              {transcribing ? 'Whisper 実行中...' : '録画から文字起こし'}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

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
                  onError={handleVideoError}
                  className="w-full bg-black"
                  style={{ maxHeight: '320px' }}
                />
              </div>
            ) : (
              <div className="mb-4 bg-gray-50 border border-gray-200 border-dashed rounded-lg p-6 text-center">
                <Video className="w-5 h-5 text-gray-400 mx-auto mb-3" strokeWidth={1.75} />
                {videoLoadError && (
                  <p className="text-xs text-red-600 mb-3">
                    サーバー上の録画を読み込めませんでした（リンクの期限切れの可能性があります）。ページを再読み込みするか、下記からローカルの録画ファイルを読み込んでください。
                  </p>
                )}
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
