'use client'

import { useState, useEffect, use, useMemo } from 'react'
import Link from 'next/link'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { Search, X, Pencil, Download, FlaskConical, RefreshCw, Trash2, SlidersHorizontal, Presentation } from 'lucide-react'
import { hasPermission } from '@/lib/permissions'
import EditInterviewModal from '@/components/EditInterviewModal'
import FloatingAgentChat from '@/components/FloatingAgentChat'
import StatusBadge from '@/components/StatusBadge'
import TypeBadge from '@/components/TypeBadge'
import InterviewMetrics from '@/components/InterviewMetrics'
import InterviewSummary from '@/components/InterviewSummary'
import TranscriptSearch from '@/components/TranscriptSearch'
import AnswerMatrix from '@/components/AnswerMatrix'
import BulkDeleteModal from '@/components/BulkDeleteModal'
import { type TaskResultData, type AnswerData } from '@/components/SessionMetrics'

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'status'
type StatusFilter = 'all' | 'pending' | 'active' | 'done' | 'completed'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date-desc', label: '新しい順' },
  { value: 'date-asc', label: '古い順' },
  { value: 'name-asc', label: '参加者名順' },
  { value: 'status', label: 'ステータス順' },
]
const STATUS_LABELS: Record<string, string> = {
  all: 'すべて', pending: '待機中', active: '進行中', done: '分析済み', completed: '完了',
}

interface SessionStat {
  id: string
  participantName: string
  status: string
  createdAt: string
  summary: string | null
  themes: string | null
  dominantEmotion: string | null
  avgEmotion: { happy: number; neutral: number; sad: number; surprised: number } | null
  segmentCount: number
  taskResults?: TaskResultData[]
  answers?: AnswerData[]
  highlightTags?: string[]
  screenerAnswers?: { label: string; value: string; order: number }[]
  isPilot?: boolean
}

interface CompareData {
  interview: {
    id: string
    title: string
    description: string | null
    objective: string | null
    type: string
    questions: { id: string; text: string; order: number; type: string; imageUrl?: string | null; imageMode?: string | null; imageDuration?: number | null; followUpEnabled?: boolean; followUpDepth?: number; naturalCapture?: boolean }[]
    tasks: { id: string; text: string; order: number; hint?: string | null; isPrerequisite?: boolean | null }[]
    seqEnabled?: boolean
    hintDelaySec?: number | null
    screeners?: { id: string; label: string; options: string[]; disqualify: string[]; required: boolean; order: number }[]
  }
  sessions: SessionStat[]
  commonInsights: string | null
  /** 閲覧者自身のロール。破壊的な操作を出すかどうかの判定にだけ使う */
  viewerRole?: string
}

/**
 * 事前質問（スクリーナー）の回答による絞り込み判定。
 * 空文字の値は「すべて」なので条件から外す。
 */
function matchesAttrs(
  s: { screenerAnswers?: { label: string; value: string }[] },
  filter: Record<string, string>
): boolean {
  return Object.entries(filter).every(
    ([label, value]) =>
      !value || (s.screenerAnswers ?? []).some((a) => a.label === label && a.value === value)
  )
}

const EMOTION_LABELS: Record<string, string> = {
  happy: '喜び', neutral: '中立', sad: '悲しみ', surprised: '驚き',
  angry: '怒り', fearful: '恐怖', disgusted: '嫌悪',
}

const EMOTION_COLORS: Record<string, string> = {
  happy: 'text-emerald-700', neutral: 'text-gray-600',
  sad: 'text-blue-700', surprised: 'text-orange-700',
}

export default function InterviewComparePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params)
  const [data, setData] = useState<CompareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 個別結果一覧のソート/フィルタ
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  const [pilotStarting, setPilotStarting] = useState(false)
  const [generatingSlides, setGeneratingSlides] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeMsg, setReanalyzeMsg] = useState('')
  // 削除は配下の全セッションを巻き込むので、confirm ではなくテスト名の入力を要求する
  const [dangerOpen, setDangerOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [deletingInterview, setDeletingInterview] = useState(false)

  async function deleteInterview() {
    setDeletingInterview(true)
    try {
      const res = await fetch(`/api/interviews/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(
          res.status === 403
            ? 'このテストを削除する権限がありません（管理者以上が必要です）。'
            : (d?.error ?? '削除に失敗しました')
        )
        return
      }
      window.location.href = '/dashboard'
    } catch {
      alert('削除に失敗しました')
    } finally {
      setDeletingInterview(false)
    }
  }

  async function bulkDeleteSessions() {
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/sessions/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedVisibleSessions.map((s) => s.id) }),
      })
      const resData = await res.json().catch(() => null)
      if (!res.ok || !resData) {
        alert(
          res.status === 403
            ? '削除する権限がありません（編集者以上が必要です）。'
            : (resData?.error ?? '削除に失敗しました')
        )
        return
      }
      const ng = resData.failed?.length > 0
        ? `\n${resData.failed.length} 件は削除できませんでした。`
        : ''
      setBulkDeleteOpen(false)
      setSelectedSessionIds(new Set())
      setReloadKey((k) => k + 1)
      if (ng) alert(`${resData.deleted?.length ?? 0} 件を削除しました。${ng}`)
    } catch {
      alert('削除に失敗しました')
    } finally {
      setBulkDeleting(false)
    }
  }

  // 全セッションをまとめて再分析する。
  // AI へのプロンプトを変えた後（要約の日本語化など）に既存セッションを追随させる用途。
  // 1回のリクエストで処理できる件数に限りがあるため、残りが無くなるまで自動で繰り返す。
  async function reanalyzeAll() {
    if (!confirm('このテストの全セッションをAIで再分析します。\n要約・テーマ・感情判定が作り直されます（録画と表情データは変更しません）。\n\n件数が多い場合は自動で続けて処理します。よろしいですか？')) return
    setReanalyzing(true)
    setReanalyzeMsg('再分析を開始しています…')
    let totalDone = 0
    let totalFailed = 0
    let skip = 0
    try {
      // 上限を設けて無限ループを防ぐ（1回あたり最大3件）
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`/api/interviews/${id}/reanalyze?skip=${skip}`, { method: 'POST' })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) {
          alert(data?.error ?? `再分析が途中で終了しました。${totalDone} 件は完了しています。もう一度実行すると続きから再開します。`)
          break
        }
        totalDone += data.done
        totalFailed += data.failed
        skip = data.nextSkip
        setReanalyzeMsg(`再分析中… ${totalDone} 件完了（残り ${data.remaining} 件）`)
        if (data.remaining <= 0) break
        // 1件も進まなかったら打ち切る（時間切れで着手できなかった等）
        if (data.done === 0 && data.failed === 0) {
          alert(`時間の都合で一旦停止しました。${totalDone} 件完了。もう一度実行すると続きから再開します。`)
          break
        }
      }
      const ng = totalFailed > 0 ? `\n${totalFailed} 件は失敗しました（元の内容はそのまま残っています）。` : ''
      alert(totalDone > 0 || totalFailed > 0
        ? `${totalDone} 件を再分析しました。${ng}`
        : '再分析の対象になるセッションがありませんでした。')
      window.location.reload()
    } catch {
      alert('再分析に失敗しました')
    } finally {
      setReanalyzing(false)
      setReanalyzeMsg('')
    }
  }
  // 文字起こししか無い過去セッションから、質問ごとの回答を復元する
  async function backfillAnswers() {
    if (!confirm('文字起こしから、質問ごとの回答をAIが抽出して保存します。\n実施中に保存された回答があるセッションは変更しません。よろしいですか？')) return
    setBackfilling(true)
    try {
      const res = await fetch(`/api/interviews/${id}/backfill-answers`, { method: 'POST' })
      // タイムアウト（504）は本文が JSON でないことがある。その場合でも
      // 一部は保存済みの可能性があるため、必ず再読み込みして結果を反映する。
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        alert(
          data?.error ??
            '抽出が途中で終了しました。保存できた分を反映します。残りがあれば、もう一度実行してください。'
        )
        window.location.reload()
        return
      }
      const rest = data.remaining > 0 ? `\n残り ${data.remaining} 件は、もう一度実行してください。` : ''
      const ng = data.failed > 0 ? `\n${data.failed} 件は抽出できませんでした。` : ''
      alert(`${data.filled} 件のセッションから回答を抽出しました。${ng}${rest}`)
      window.location.reload()
    } catch {
      alert('抽出に失敗しました')
    } finally {
      setBackfilling(false)
    }
  }

  // パイロット: 本番集計に含まれないセッションを作り、被験者フローをそのまま開く
  async function runPilot() {
    if (!confirm('パイロット（お試し）を開始します。\nこの結果は集計・分析には含まれません。よろしいですか？')) return
    setPilotStarting(true)
    try {
      const res = await fetch(`/api/interviews/${id}/pilot`, { method: 'POST' })
      if (!res.ok) { alert('パイロットの開始に失敗しました'); return }
      const data = await res.json()
      window.location.href = data.url
    } catch {
      alert('パイロットの開始に失敗しました')
    } finally {
      setPilotStarting(false)
    }
  }
  async function generateSlides() {
    setGeneratingSlides(true)
    try {
      const res = await fetch(`/api/interviews/${id}/slides`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.error === 'google_not_connected') {
          if (confirm('スライド資料の生成には、ご自身のGoogleアカウントの接続が必要です。接続画面を開きますか？')) {
            window.location.href = '/dashboard/settings/google'
          }
          return
        }
        alert('スライド資料の生成に失敗しました')
        return
      }
      // 新しいタブで開く（この結果画面からは離れない）
      window.open(data.url, '_blank')
    } catch {
      alert('スライド資料の生成に失敗しました')
    } finally {
      setGeneratingSlides(false)
    }
  }
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date-desc')
  // 事前質問の回答（属性）によるセグメント絞り込み。ラベル → 選んだ値。空文字は「すべて」
  const [attrFilter, setAttrFilter] = useState<Record<string, string>>({})

  // 個別結果一覧の複数選択・一括削除
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  function toggleSessionSelect(id: string) {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleSessions = useMemo(() => {
    const STATUS_ORDER: Record<string, number> = { active: 0, pending: 1, done: 2, completed: 3 }
    return (data?.sessions ?? [])
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) => matchesAttrs(s, attrFilter))
      .filter((s) => (search.trim() ? s.participantName.toLowerCase().includes(search.trim().toLowerCase()) : true))
      .slice()
      .sort((a, b) => {
        if (sortKey === 'name-asc') return a.participantName.localeCompare(b.participantName, 'ja')
        if (sortKey === 'status') return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        const da = new Date(a.createdAt).getTime(), db = new Date(b.createdAt).getTime()
        return sortKey === 'date-asc' ? da - db : db - da
      })
  }, [data, statusFilter, search, sortKey, attrFilter])
  const isFiltering =
    statusFilter !== 'all' || search.trim() !== '' || Object.values(attrFilter).some((v) => v)

  // 選択されているのに、絞り込みで見えなくなった id は確認ダイアログにも削除対象にも含めない
  // （見えていない項目が消えることに気づけないまま実行してしまうのを防ぐ）
  const selectedVisibleSessions = visibleSessions.filter((s) => selectedSessionIds.has(s.id))

  // 集計対象の変更後にデータを取り直すためのカウンタ。
  // 画面全体をリロードすると AI インサイトの再取得やスクロール位置の喪失が起きるので、
  // このページのデータだけを差し替える。
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/interviews/${id}/compare`)
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        if (!r.ok) throw new Error('failed')
        return r.json()
      })
      .then((d) => { if (!cancelled && d) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [id, reloadKey])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <div className="text-gray-700 text-sm">データの読み込みに失敗しました。</div>
        <button
          onClick={() => window.location.reload()}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors"
        >
          再試行
        </button>
      </div>
    )
  }

  const { interview, sessions, commonInsights, viewerRole } = data
  // パイロット（リサーチャーの試行）は本番の結果ではないので、集計・分析からは除外する。
  // 一覧には残してバッジで区別し、消したくなったら削除できるようにする。
  const realSessions = sessions.filter((s) => !s.isPilot)
  const pilotCount = sessions.length - realSessions.length
  const doneAll = realSessions.filter((s) => s.status === 'done').length

  // ── セグメント（事前質問の回答による絞り込み） ──
  // 「初心者だけのタスク成功率」を見るのがユーザビリティテストの一次分析なので、
  // 絞り込みは一覧だけでなく、下の集計・比較・レーダーすべてに効かせる。
  // 選べる値は実際に回答があったものだけを出す（0人の選択肢を並べても選ぶ意味がない）。
  const attributeDefs = (() => {
    const m = new Map<string, { order: number; values: Set<string> }>()
    for (const s of realSessions) {
      for (const a of s.screenerAnswers ?? []) {
        const cur = m.get(a.label) ?? { order: a.order, values: new Set<string>() }
        cur.order = Math.min(cur.order, a.order)
        cur.values.add(a.value)
        m.set(a.label, cur)
      }
    }
    return [...m.entries()]
      .sort(([, x], [, y]) => x.order - y.order)
      .map(([label, v]) => ({ label, values: [...v.values].sort((a, b) => a.localeCompare(b, 'ja')) }))
  })()

  const isSegmented = Object.values(attrFilter).some((v) => v)
  const segmentedSessions = isSegmented
    ? realSessions.filter((s) => matchesAttrs(s, attrFilter))
    : realSessions

  // 分析系（インサイト・テーマ・比較・レーダー）は分析済み(done)のみで算出
  const doneSessions = segmentedSessions.filter((s) => s.status === 'done')

  // レーダーチャート用データ（参加者ごとの感情平均）
  const radarData = ['happy', 'neutral', 'sad', 'surprised'].map((emotion) => ({
    emotion: EMOTION_LABELS[emotion],
    ...Object.fromEntries(
      // 同名参加者や名前中の「.」で系列が衝突しないよう、一意な session id をキーにする
      doneSessions.map((s) => [
        s.id,
        s.avgEmotion ? Math.round((s.avgEmotion[emotion as keyof typeof s.avgEmotion] ?? 0) * 100) : 0,
      ])
    ),
  }))

  // テーマの出現頻度を集計
  const themeCount: Record<string, number> = {}
  doneSessions.forEach((s) => {
    s.themes?.split(',').forEach((t) => {
      const key = t.trim()
      if (key) themeCount[key] = (themeCount[key] ?? 0) + 1
    })
  })
  const sortedThemes = Object.entries(themeCount).sort(([, a], [, b]) => b - a)

  // ハイライトのタグ頻度（人が付けた記録なので、AI 分析未完了のセッションも対象にする）
  const highlightTagCount: Record<string, number> = {}
  segmentedSessions.forEach((s) => {
    s.highlightTags?.forEach((t) => {
      const key = t.trim()
      if (key) highlightTagCount[key] = (highlightTagCount[key] ?? 0) + 1
    })
  })
  const sortedHighlightTags = Object.entries(highlightTagCount).sort(([, a], [, b]) => b - a)
  const highlightTagTotal = sortedHighlightTags.reduce((sum, [, c]) => sum + c, 0)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="font-semibold tracking-tight text-gray-900">UserVoice</Link>
          <span className="text-gray-300">/</span>
          <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">ダッシュボード</Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900">{interview.title}</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TypeBadge type={interview.type} />
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{interview.title}</h1>
            </div>
            <p className="text-gray-500 text-sm">
              セッション {realSessions.length} 件（分析済み {doneAll} 件） · 質問 {interview.questions.length} 問
              {pilotCount > 0 && <span className="text-gray-400"> · パイロット {pilotCount} 件（集計対象外）</span>}
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            <a
              href={`/api/interviews/${interview.id}/export`}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
              title="全セッションのタスク結果・回答・ハイライトを1つのCSVにまとめて出力"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={2} />
              CSV出力
            </a>
            <button
              onClick={generateSlides}
              disabled={generatingSlides}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
              title="現在の集計結果からGoogleスライドの資料を自動生成します（ご自身のGoogle Driveに保存されます）"
            >
              <Presentation className="w-3.5 h-3.5" strokeWidth={2} />
              {generatingSlides ? '生成中…' : 'スライド資料を生成'}
            </button>
            <button
              onClick={reanalyzeAll}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
              title="全セッションの要約・テーマ・感情判定をAIで作り直します（要約が英語のままのものを日本語にし直す用途）"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} strokeWidth={2} />
              {reanalyzing ? (reanalyzeMsg || '再分析中…') : '全件を再分析'}
            </button>
            <button
              onClick={runPilot}
              disabled={pilotStarting}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
              title="本番データに含めずに、被験者と同じ流れを自分で試す"
            >
              <FlaskConical className="w-3.5 h-3.5" strokeWidth={2} />
              パイロット実行
            </button>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-md text-sm transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
              編集
            </button>
          </div>
        </div>

        {/* セグメント絞り込み。ここから下の集計・比較・レーダーすべてに効く */}
        {attributeDefs.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5 flex-shrink-0">
                <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={2} />
                セグメント
              </span>
              {attributeDefs.map((a) => (
                <label key={a.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                  {a.label}
                  <select
                    value={attrFilter[a.label] ?? ''}
                    onChange={(e) => setAttrFilter((prev) => ({ ...prev, [a.label]: e.target.value }))}
                    className="bg-white border border-gray-300 focus:border-gray-900 text-gray-800 text-xs rounded-md px-2 py-1 focus:outline-none transition-colors"
                  >
                    <option value="">すべて</option>
                    {a.values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              ))}
              <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-500 tabular-nums">
                  {isSegmented
                    ? `${segmentedSessions.length} / ${realSessions.length} 人を表示中`
                    : `${realSessions.length} 人`}
                </span>
                {isSegmented && (
                  <button
                    onClick={() => setAttrFilter({})}
                    className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
                  >
                    解除
                  </button>
                )}
              </div>
            </div>
            {/* 0人のときは下の集計が軒並み空になる。「セッションがありません」と
                読めてしまうので、絞り込みの結果であることをここで明示する */}
            {isSegmented && segmentedSessions.length === 0 && (
              <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                この条件に当てはまる参加者はいません。下の集計が空なのは、調査にデータが無いからではなく絞り込みの結果です。
              </p>
            )}
            {/* 少人数のセグメントは割合の振れ幅が大きい。数字を鵜呑みにしないよう添える */}
            {isSegmented && segmentedSessions.length > 0 && segmentedSessions.length < 5 && (
              <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                該当は {segmentedSessions.length} 人です。人数が少ないと割合は大きく振れるので、傾向の目安として見てください。
              </p>
            )}
          </div>
        )}

        {/* 調査全体の結論。参加者一覧より先に「この調査がどうだったか」を出す */}
        <InterviewSummary
          sessions={segmentedSessions}
          objective={interview.objective}
          commonInsights={commonInsights}
          onBackfill={backfillAnswers}
          backfilling={backfilling}
          /* AI 総括は調査全体で生成したもので、絞り込みには追随しない。
             抽出も調査全体に効く処理なので、絞り込み中は導線を出さない */
          segmented={isSegmented}
        />

        {/* 定量集計のタスク別内訳。AI 分析の完了を待たずに出せるので done で絞らない */}
        <InterviewMetrics
          sessions={segmentedSessions}
          interviewId={interview.id}
          onChanged={() => setReloadKey((k) => k + 1)}
          /* 集計対象の変更は調査全体に効く。絞り込み中に押せると、
             見えている一部を外したつもりで全体を外してしまう */
          allowExclude={!isSegmented}
        />

        {/* 回答の比較（質問 × 参加者）。深掘りは元の質問にまとめて紐づくので列は崩れない */}
        <AnswerMatrix
          sessions={segmentedSessions}
          questions={interview.questions}
          onBackfill={isSegmented ? undefined : backfillAnswers}
          backfilling={backfilling}
        />

        {/* 個別の結果一覧（全ステータス・ソート/フィルタ/検索） */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-auto">個別の結果</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="参加者名で検索"
                className="bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:outline-none transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-md">
              {(['all', 'pending', 'active', 'done', 'completed'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-white border border-gray-300 text-gray-700 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-gray-900 transition-colors"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* 選択バー。編集者以上にのみ削除操作を出す（単体のセッション削除と同じ権限） */}
          {visibleSessions.length > 0 && hasPermission(viewerRole ?? 'viewer', 'editor') && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-xs text-gray-600 bg-gray-50">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedVisibleSessions.length > 0 && selectedVisibleSessions.length === visibleSessions.length}
                  ref={(el) => {
                    if (el) {
                      const n = selectedVisibleSessions.length
                      el.indeterminate = n > 0 && n < visibleSessions.length
                    }
                  }}
                  onChange={(e) => {
                    setSelectedSessionIds(e.target.checked ? new Set(visibleSessions.map((s) => s.id)) : new Set())
                  }}
                  className="accent-gray-900"
                />
                すべて選択
              </label>
              {selectedVisibleSessions.length > 0 && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>{selectedVisibleSessions.length} 件選択中</span>
                  <button
                    onClick={() => setBulkDeleteOpen(true)}
                    className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-medium ml-1"
                  >
                    <Trash2 className="w-3 h-3" strokeWidth={2} />
                    削除
                  </button>
                  <button onClick={() => setSelectedSessionIds(new Set())} className="text-gray-500 hover:text-gray-900 underline underline-offset-2">
                    選択を解除
                  </button>
                </>
              )}
            </div>
          )}

          {visibleSessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {isFiltering ? '条件に一致する結果がありません' : 'まだセッションがありません。招待リンクを参加者に送りましょう。'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visibleSessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  {hasPermission(viewerRole ?? 'viewer', 'editor') && (
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.has(s.id)}
                      onChange={() => toggleSessionSelect(s.id)}
                      aria-label={`${s.participantName} を選択`}
                      className="flex-shrink-0 accent-gray-900"
                    />
                  )}
                <Link
                  href={`/dashboard/sessions/${s.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <span className="font-medium text-sm text-gray-900 w-36 flex-shrink-0 truncate">{s.participantName}</span>
                  <StatusBadge status={s.status} />
                  {s.isPilot && (
                    <span
                      className="flex-shrink-0 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                      title="リサーチャーの試行。集計・分析には含まれません"
                    >
                      パイロット
                    </span>
                  )}
                  {/* 属性を出しておかないと、絞り込んだ結果が誰なのか一覧で確認できない */}
                  {(s.screenerAnswers?.length ?? 0) > 0 && (
                    <span className="hidden lg:flex items-center gap-1 flex-shrink-0">
                      {s.screenerAnswers!.slice(0, 2).map((a) => (
                        <span
                          key={a.order}
                          title={`${a.label}: ${a.value}`}
                          className="text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 whitespace-nowrap max-w-28 truncate"
                        >
                          {a.value}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="hidden md:block text-xs text-gray-500 flex-1 truncate">{s.summary ?? '—'}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-auto">{new Date(s.createdAt).toLocaleDateString('ja-JP')}</span>
                </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 発言の横断検索 */}
        <TranscriptSearch interviewId={interview.id} />

        {/* リサーチャーが付けたタグの頻度（AI 生成のテーマとは別。人の解釈の集計） */}
        {sortedHighlightTags.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              ハイライトのタグ（{highlightTagTotal}件）
            </h2>
            <p className="text-[11px] text-gray-400 mb-4">リサーチャーが引用に付けたタグの出現回数</p>
            <div className="flex flex-wrap gap-2">
              {sortedHighlightTags.map(([tag, count]) => (
                <span key={tag} className="inline-flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-gray-800 px-2.5 py-1 rounded-md text-xs">
                  {tag}
                  <span className="text-[10px] font-semibold text-yellow-800 bg-yellow-100 px-1.5 rounded-full">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {doneSessions.length === 0 ? null : (
          <>
            {/* AI 共通インサイトは結果サマリー（ページ最上部）に移動した */}

            {/* テーマ頻度 */}
            {sortedThemes.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
                  テーマ出現頻度
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {sortedThemes.map(([theme, count]) => (
                    <span
                      key={theme}
                      className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-md text-xs"
                    >
                      <span className="text-gray-900 font-semibold">{count}</span>
                      <span className="text-gray-600">{theme}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 参加者比較テーブル */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-200">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">参加者比較</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">参加者</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">主要テーマ</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">主な感情</th>
                      <th className="text-left px-6 py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wide">サマリー</th>
                      <th className="px-6 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {doneSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">{s.participantName}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              const themes = s.themes?.split(',').map((t) => t.trim()).filter(Boolean) ?? []
                              return themes.length > 0
                                ? themes.slice(0, 3).map((t, i) => (
                                    <span key={i} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs">
                                      {t}
                                    </span>
                                  ))
                                : <span className="text-gray-400">—</span>
                            })()}
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          {s.dominantEmotion ? (
                            <span className={`font-medium text-sm ${EMOTION_COLORS[s.dominantEmotion] ?? 'text-gray-600'}`}>
                              {EMOTION_LABELS[s.dominantEmotion] ?? s.dominantEmotion}
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-6 py-3 max-w-xs">
                          <p className="text-gray-500 text-xs line-clamp-2">{s.summary ?? '—'}</p>
                        </td>
                        <td className="px-6 py-3">
                          <Link
                            href={`/dashboard/sessions/${s.id}`}
                            className="text-gray-900 hover:text-gray-700 text-xs font-medium whitespace-nowrap underline underline-offset-2"
                          >
                            詳細
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 感情レーダーチャート */}
            {doneSessions.some((s) => s.avgEmotion) && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
                  感情プロファイル比較
                </h2>
                <div className="flex gap-3 justify-center flex-wrap mb-4">
                  {doneSessions.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }}
                      />
                      {s.participantName}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="emotion" tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v) => `${v ?? 0}%`}
                    />
                    {doneSessions.map((s, i) => (
                      <Radar
                        key={s.id}
                        name={s.participantName}
                        dataKey={s.id}
                        stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* テストの削除。配下の全セッションを巻き込むため、管理者にだけ出し、
            テスト名の入力を要求する（confirm のワンクリックでは重すぎる操作） */}
        {hasPermission(viewerRole ?? 'viewer', 'admin') && (
          <div className="border-t border-gray-200 pt-6">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">危険な操作</h2>
            <div className="bg-white border border-red-200 rounded-lg px-4 py-3">
              {!dangerOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-gray-600 leading-relaxed min-w-0">
                    このテストを削除します。{sessions.length} 件のセッション（録画・文字起こし・回答・ハイライト）も
                    まとめて消え、元に戻せません。
                  </p>
                  <button
                    onClick={() => { setDangerOpen(true); setConfirmTitle('') }}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 border border-red-300 hover:border-red-500 hover:bg-red-50 text-red-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                    このテストを削除
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-700 leading-relaxed">
                    確認のため、テスト名「<span className="font-medium text-gray-900">{interview.title}</span>」を
                    入力してください。{sessions.length} 件のセッションが一緒に削除されます。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={confirmTitle}
                      onChange={(e) => setConfirmTitle(e.target.value)}
                      aria-label="確認のためテスト名を入力"
                      placeholder={interview.title}
                      className="flex-1 min-w-48 bg-white border border-gray-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-md px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
                    />
                    <button
                      onClick={() => { setDangerOpen(false); setConfirmTitle('') }}
                      className="border border-gray-300 hover:border-gray-400 text-gray-700 px-3 py-1.5 rounded-md text-xs transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={deleteInterview}
                      disabled={deletingInterview || confirmTitle.trim() !== interview.title.trim()}
                      className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      {deletingInterview ? '削除中…' : '完全に削除する'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <EditInterviewModal
          interview={interview}
          sessionCount={realSessions.length}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); window.location.reload() }}
        />
      )}

      {bulkDeleteOpen && (
        <BulkDeleteModal
          itemLabel="セッション"
          items={selectedVisibleSessions.map((s) => ({ id: s.id, label: s.participantName }))}
          detailNote="録画・文字起こし・回答・ハイライトがすべてサーバーから削除されます。"
          deleting={bulkDeleting}
          onConfirm={bulkDeleteSessions}
          onClose={() => setBulkDeleteOpen(false)}
        />
      )}

      {/* フローティング AI チャット（このインタビュー全体について質問） */}
      <FloatingAgentChat interviewId={id} />
    </div>
  )
}

const RADAR_COLORS = ['#1f2937', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
