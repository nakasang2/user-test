'use client'

import { useState, useEffect, use, useRef } from 'react'
import Link from 'next/link'
import EmotionChart from '@/components/EmotionChart'
import TranscriptView from '@/components/TranscriptView'
import FloatingAgentChat from '@/components/FloatingAgentChat'
import StatusBadge from '@/components/StatusBadge'
import SessionMetrics, { type TaskResultData, type AnswerData } from '@/components/SessionMetrics'
import HighlightPanel, { type HighlightData } from '@/components/HighlightPanel'
import { Video, Download, X, Folder, Copy, Check, Trash2 } from 'lucide-react'
import { track } from '@/lib/analytics'
import { outcomeLabel } from '@/lib/task-flow'
import { canEdit } from '@/lib/permissions'

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
  taskResults?: TaskResultData[]
  answers?: AnswerData[]
  consentedAt?: string | null
  screenerAnswers?: { label: string; value: string; order: number }[]
  isPilot?: boolean
  /** 閲覧者自身のロール。破壊的な操作を出すかどうかの判定にだけ使う */
  viewerRole?: string
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
  const [highlights, setHighlights] = useState<HighlightData[]>([])
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ── 参加者用URL ──
  // リサーチャーがこの画面から欲しいのは「参加者に渡すリンク」であって、
  // 自分がテストを始めることではない。主ボタンはコピーにする。
  async function copyParticipantUrl() {
    if (!session) return
    const url = `${window.location.origin}/interview/${session.dailyRoomName}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {
      // クリップボードが使えない環境（非HTTPS等）のフォールバック
      window.prompt('以下のリンクをコピーしてください', url)
    }
  }

  /**
   * 参加者用のテスト画面をリサーチャー自身が開く。
   *
   * ここから開始すると status が active に戻り、タスク結果は (sessionId, order) の
   * upsert で、録画は URL 差し替えで上書きされる。元には戻せない。
   * 押し間違いで実施済みの記録が消えるので、何が起きるかを伝えてから遷移する。
   */
  function openParticipantRoom() {
    if (!session) return
    const hasData =
      !!session.transcript || (session.taskResults?.length ?? 0) > 0 || !!session.recordingUrl
    const warning = hasData
      ? 'このセッションには既に記録（録画・文字起こし・タスク結果）があります。\nここから開始すると上書きされ、元に戻せません。'
      : 'あなたがここで開始すると、このセッションは実施済みとして記録され、参加者の分としては使えなくなります。'
    const ok = confirm(
      `これは参加者用のテスト画面です。\n\n${warning}\n\n` +
        '参加者にリンクを渡すだけなら「参加者用URLをコピー」を使ってください。\n\nそれでも開きますか？'
    )
    if (!ok) return
    window.location.href = `/interview/${session.dailyRoomName}`
  }

  async function deleteSession() {
    if (!session) return
    const name = session.participant?.name ?? 'Anonymous'
    const ok = confirm(
      `「${name}」のセッションを削除します。\n` +
        '録画・文字起こし・タスク結果・回答・ハイライトがすべて消え、元に戻せません。\n\n削除しますか？'
    )
    if (!ok) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(
          res.status === 403
            ? 'セッションを削除する権限がありません（編集者以上が必要です）。'
            : (d?.error ?? '削除に失敗しました')
        )
        return
      }
      window.location.href = `/dashboard/interviews/${session.interview.id}`
    } catch {
      alert('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  // ── ハイライト（定性分析のコーディング） ──
  async function addHighlight(seg: { id: string; text: string; startTime: number }) {
    try {
      const res = await fetch(`/api/sessions/${id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: seg.text, segmentId: seg.id, startTime: seg.startTime }),
      })
      if (!res.ok) { alert('ハイライトの追加に失敗しました'); return }
      const data = await res.json()
      setHighlights((prev) => [...prev, data.highlight].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)))
    } catch { alert('ハイライトの追加に失敗しました') }
  }

  async function updateHighlight(highlightId: string, patch: { note?: string; tags?: string[] }) {
    const res = await fetch(`/api/highlights/${highlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) { alert('保存に失敗しました'); return }
    const data = await res.json()
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? data.highlight : h)))
  }

  async function deleteHighlight(highlightId: string) {
    if (!confirm('このハイライトを削除しますか？')) return
    const res = await fetch(`/api/highlights/${highlightId}`, { method: 'DELETE' })
    if (!res.ok) { alert('削除に失敗しました'); return }
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId))
  }

  function seekVideo(sec: number) {
    if (!videoRef.current) return
    videoRef.current.currentTime = sec
    videoRef.current.play()
  }

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

    // ハイライトも同時に取得（セッション取得と同じ cancelled ガードのパターンに揃える）
    fetch(`/api/sessions/${id}/highlights`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setHighlights(d.highlights ?? []) })
      .catch(() => { /* 取得失敗時は空のまま */ })

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
    // 被験者の発言が無期限に公開され続けないよう、期限を選ばせる（既定 30 日）
    const input = prompt('共有リンクの有効期限を日数で入力してください（0 = 無期限）', '30')
    if (input === null) return
    const expiresInDays = Number(input)
    if (!Number.isFinite(expiresInDays) || expiresInDays < 0) {
      alert('日数は0以上の数値で入力してください')
      return
    }
    try {
      const res = await fetch(`/api/sessions/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays }),
      })
      if (!res.ok) throw new Error('failed')
      const { shareToken, shareExpiresAt } = await res.json()
      const url = `${window.location.origin}/share/${shareToken}`
      await navigator.clipboard.writeText(url)
      track('report_shared', { sessionId: id })
      setSession((prev) => (prev ? { ...prev, shareEnabled: true } : prev))
      const until = shareExpiresAt
        ? `\n有効期限: ${new Date(shareExpiresAt).toLocaleDateString('ja-JP')}`
        : '\n有効期限: なし'
      alert(`読み取り専用の共有リンクをコピーしました:\n${url}${until}`)
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
    // Excel の数式インジェクション対策。=, +, -, @ とタブ/CR 始まりを無害化する。
    // 被験者側から書き込める値（speaker 含む）は必ずこれを通すこと。
    const q = (v: string) => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
      return `"${safe.replace(/"/g, '""')}"`
    }
    const rows: string[][] = []

    // 測定結果（定量）を先頭に。表計算ソフトで成功率・スコアを扱えるようにする
    if (session.taskResults?.length) {
      // includedInMetrics: 画面の「測定結果」が対象にしている行か。
      // この列が無いと、CSV を手元で集計した数字と画面の数字が食い違う
      rows.push(['# タスク結果'], ['order', 'task', 'outcome', 'usedHint', 'assistedStart', 'durationSec', 'seq', 'includedInMetrics'])
      session.taskResults.forEach((t) => rows.push([
        String(t.order), q(t.text),
        outcomeLabel(t.outcome),
        t.usedHint ? 'ヒントあり' : '自力',
        t.assistedStart ? '前提を代行' : '',
        t.durationSec != null ? String(Math.round(t.durationSec)) : '',
        t.seq != null ? String(t.seq) : '',
        t.excludedAt ? '集計対象外' : '集計対象',
      ]))
      rows.push([])
    }
    if (session.answers?.length) {
      rows.push(['# 回答'], ['order', 'question', 'type', 'value', 'text', 'followUpCount', 'sentiment', 'includedInMetrics'])
      session.answers.forEach((a) => rows.push([
        String(a.order), q(a.text), a.type,
        a.valueNum != null ? String(a.valueNum) : '',
        q(a.valueText ?? ''),
        a.followUpCount != null ? String(a.followUpCount) : '',
        q(a.sentiment ?? ''),
        a.excludedAt ? '集計対象外' : '集計対象',
      ]))
      rows.push([])
    }

    if (highlights.length) {
      rows.push(['# ハイライト'], ['startTime', 'quote', 'note', 'tags'])
      highlights.forEach((h) => rows.push([
        h.startTime != null ? String(Math.round(h.startTime)) : '',
        q(h.quote), q(h.note ?? ''), q(h.tags.join(' / ')),
      ]))
      rows.push([])
    }

    rows.push(['# 文字起こし'], ['speaker', 'text', 'startTime', 'endTime', 'sentiment'])
    session.transcript?.segments.forEach((s) => rows.push([
      q(s.speaker), q(s.text), String(s.startTime), String(s.endTime), q(s.sentiment ?? ''),
    ]))

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
          {session.isPilot && (
            <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded ml-2">
              パイロット（集計対象外）
            </span>
          )}
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
          {/* 参加者画面を開く導線は、記録を上書きしうるので副次的な扱いにする。
              主ボタンは「参加者に渡すリンクのコピー」 */}
          <button
            onClick={openParticipantRoom}
            title="参加者と同じテスト画面を開きます。開始すると、このセッションの記録が上書きされます"
            className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 transition-colors px-1"
          >
            参加者画面を開く
          </button>
          <button
            onClick={copyParticipantUrl}
            className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {copiedUrl ? (
              <><Check className="w-3.5 h-3.5" strokeWidth={2.5} /> コピー済み</>
            ) : (
              <><Copy className="w-3.5 h-3.5" strokeWidth={2} /> 参加者用URLをコピー</>
            )}
          </button>
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
        {/* コピーの導線は右上に一本化する。2か所に置くと、どちらを押すべきか迷う */}
        {(session.status === 'pending' || session.status === 'active') && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-amber-800 text-sm">
              このセッションはまだ完了していません。右上の「参加者用URLをコピー」から、参加者にリンクを送ってください。
            </p>
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

        {/* 参加者の属性（事前質問の回答）。誰のデータかを解釈する手がかり */}
        {(session.screenerAnswers?.length ?? 0) > 0 && (
          <div className="mb-6">
            <SectionLabel>参加者の属性</SectionLabel>
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-2">
              {session.screenerAnswers!.map((a) => (
                <span key={a.order} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1 text-xs">
                  <span className="text-gray-500">{a.label}</span>
                  <span className="text-gray-900 font-medium">{a.value}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 測定結果（定量）: 分析の起点なので最上部に置く ── */}
        {((session.taskResults?.length ?? 0) > 0 || (session.answers?.length ?? 0) > 0) && (
          <div className="mb-6">
            <SectionLabel>測定結果</SectionLabel>
            <SessionMetrics
              taskResults={session.taskResults ?? []}
              answers={session.answers ?? []}
              onSeek={videoSrc ? seekVideo : undefined}
            />
          </div>
        )}

        {/* 表情の総括指標（平均％・最頻表情・平均分布）。
            セッション全体を要約する情報なので、会話ログより前・測定結果の隣に置く。
            時系列グラフは下の録画ブロックにあるので、ここでは出さない（重複防止）。 */}
        {session.emotions.length > 0 && (
          <div className="mb-6">
            <SectionLabel>表情エンゲージメント指標（参考）</SectionLabel>
            <EmotionChart variant="summary" emotions={session.emotions} />
          </div>
        )}

        {/* ── 録画と表情グラフ（時間軸は横） ──
            画面上部に固定し、実質的に動画のシークバーとして使う。
            会話ログは時間軸が縦なので、横に並べると向きが競合して見比べにくい。
            上下に分けることで両方を全幅で見せられる。 */}
        <div className="lg:sticky lg:top-0 z-20 bg-white lg:pt-3 lg:pb-4 mb-6 lg:border-b lg:border-gray-200">
          <SectionLabel>録画と表情の推移（クリックでその時刻へ）</SectionLabel>
          {/* 動画は左、時系列グラフは右。グラフに横幅を与えて山谷を読みやすくする */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,32rem)_1fr] gap-4 items-start">

            {/* 動画プレーヤー or ファイルピッカー */}
            {videoSrc ? (
              <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                {/* 操作の説明はグラフ側に出しているので、ここでは繰り返さない。
                    「別のファイル」はローカル読み込み中にしか意味がない
                    （サーバー録画のときは押しても何も起きない）ため、その場合だけ出す。 */}
                {localVideoUrl && (
                  <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                    <p className="text-xs text-gray-500">読み込んだローカルファイルを再生中</p>
                    <button
                      onClick={clearLocalVideo}
                      className="text-xs text-gray-500 hover:text-gray-900 transition-colors ml-4 flex-shrink-0 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" strokeWidth={2} />
                      別のファイル
                    </button>
                  </div>
                )}
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

            <div className="min-w-0">
            <EmotionChart
              variant="timeline"
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

        {/* ── 下部: 会話ログとハイライト（全幅） ── */}
        <div>
            <SectionLabel>文字起こし</SectionLabel>
            <TranscriptView
              transcript={session.transcript}
              questions={session.interview.questions}
              onSeek={videoSrc ? seekVideo : undefined}
              currentTime={videoSrc ? videoCurrentTime : undefined}
              onHighlight={addHighlight}
              highlightedSegmentIds={new Set(highlights.map((h) => h.segmentId).filter((v): v is string => !!v))}
            />

            {/* ハイライト（引用＋メモ＋タグ）: 定性分析の作業場 */}
            <div className="mt-6">
              <SectionLabel>ハイライト</SectionLabel>
              <HighlightPanel
                highlights={highlights}
                onUpdate={updateHighlight}
                onDelete={deleteHighlight}
                onSeek={videoSrc ? seekVideo : undefined}
              />
            </div>

        </div>

        {/* 削除。誤爆すると戻せないので、本文をすべて読み終えた最下部に置く */}
        {canEdit(session.viewerRole ?? 'viewer') && (
          <div className="mt-12 border-t border-gray-200 pt-6">
            <SectionLabel>危険な操作</SectionLabel>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-600 leading-relaxed min-w-0">
                このセッションを削除します。録画・文字起こし・タスク結果・回答・ハイライトがすべて消え、元に戻せません。
              </p>
              <button
                onClick={deleteSession}
                disabled={deleting}
                className="flex-shrink-0 inline-flex items-center gap-1.5 border border-red-300 hover:border-red-500 hover:bg-red-50 disabled:opacity-50 text-red-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                {deleting ? '削除中…' : 'セッションを削除'}
              </button>
            </div>
          </div>
        )}
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
