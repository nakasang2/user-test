'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpDown, MessageSquareMore, Search, X } from 'lucide-react'
import type { AnswerData } from './SessionMetrics'

interface SessionLike {
  id: string
  participantName: string
  status: string
  isPilot?: boolean
  answers?: AnswerData[]
}

interface QuestionCol {
  id: string
  text: string
  order: number
  type: string
  /** 印象テストで、この質問に紐づけて提示していた画像 */
  imageUrl?: string | null
}

/** 質問の型に応じた最大値（スコア表示に使う） */
const scaleMax = (type: string) => (type === 'nps' ? 10 : 5)

const TONE = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  mid:  'bg-amber-50 text-amber-800 border-amber-200',
  bad:  'bg-red-50 text-red-800 border-red-200',
}

/**
 * スコアの肯定/否定を色で示す。
 * NPS は単純な比率ではなく標準区分（推奨者9-10／中立者7-8／批判者0-6）に合わせる。
 * 比率で塗ると 8 が「肯定的」に見えてしまい、同じ画面の NPS 集計と食い違うため。
 */
function scoreTone(value: number, type: string): string {
  if (type === 'nps') {
    if (value >= 9) return TONE.good
    if (value >= 7) return TONE.mid
    return TONE.bad
  }
  // 5段階評価: 4-5 を肯定、3 をふつう、1-2 を否定
  if (value >= 4) return TONE.good
  if (value >= 3) return TONE.mid
  return TONE.bad
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '肯定的', neutral: 'ふつう', negative: '否定的',
}
const SENTIMENT_TONE: Record<string, string> = {
  positive: TONE.good, neutral: TONE.mid, negative: TONE.bad,
}
/** 自由回答セルの左端に色帯を出して、肯定/否定を一目で分かるようにする */
const SENTIMENT_BAR: Record<string, string> = {
  positive: 'border-l-2 border-emerald-400',
  neutral:  'border-l-2 border-amber-300',
  negative: 'border-l-2 border-red-400',
}

/**
 * 質問 × 被験者の回答比較テーブル。
 *
 * 「質問1に肯定的に答えた人は誰か」を横並びで見るためのもの。
 * 深掘り質問は元の質問に紐づけて1つの回答にまとめて保存しているので、
 * 人によって深掘り回数が違っても列は崩れない（回数はバッジで示す）。
 */
export default function AnswerMatrix({
  sessions,
  questions,
  onBackfill,
  backfilling,
}: {
  sessions: SessionLike[]
  questions: QuestionCol[]
  /** 文字起こしから過去の回答を復元する。未指定なら空状態でも案内だけ出す */
  onBackfill?: () => void
  backfilling?: boolean
}) {
  const [sortBy, setSortBy] = useState<string | null>(null)   // questionId
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null) // `${sessionId}:${questionId}`

  // 回答を「セッション×質問」のセルに割り当てる。
  // questionId で対応づけるので、質問を編集で並べ替えても列は崩れない。
  // questionId が失われた回答（質問を消して作り直した等）は文言で拾うが、
  // 1つの回答を複数の列に出さないよう、割り当て済みのものは再利用しない。
  const cells = useMemo(() => {
    const m = new Map<string, AnswerData>()
    sessions.forEach((s) => {
      // 集計対象外にした回答はここでも出さない。
      // 特に、質問を削除してから同じ文言で作り直した場合、下の文言一致で
      // 「集計から外したはずの古い回答」が新しい列に現役として並んでしまう。
      const answers = (s.answers ?? []).filter((a) => a.excludedAt == null)
      const used = new Set<AnswerData>()

      // 1周目: questionId が一致するものを確定させる
      questions.forEach((q) => {
        const hit = answers.find((a) => a.questionId && a.questionId === q.id)
        if (hit) { m.set(`${s.id}::${q.id}`, hit); used.add(hit) }
      })
      // 2周目: 空いた列を、未使用の回答から文言一致で埋める
      questions.forEach((q) => {
        if (m.has(`${s.id}::${q.id}`)) return
        const hit = answers.find((a) => !used.has(a) && !a.questionId && a.text === q.text)
        if (hit) { m.set(`${s.id}::${q.id}`, hit); used.add(hit) }
      })
    })
    return m
  }, [sessions, questions])

  const get = (sessionId: string, q: QuestionCol) => cells.get(`${sessionId}::${q.id}`)

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    let list = sessions.filter((s) => {
      if (!q) return true
      // 参加者名か、いずれかの回答本文に一致すれば残す。
      // 表に出していない（集計対象外の）回答にヒットさせると、
      // 行は残るのに一致箇所がどこにも見えない状態になるので同じ条件で絞る。
      if (s.participantName.toLowerCase().includes(q)) return true
      return (s.answers ?? []).filter((a) => a.excludedAt == null).some(
        (a) =>
          a.valueText?.toLowerCase().includes(q) ||
          String(a.valueNum ?? '').includes(q) ||
          // 「肯定的」「否定的」でも絞り込めるようにする
          (a.sentiment ? (SENTIMENT_LABEL[a.sentiment] ?? '').includes(q) : false)
      )
    })
    if (sortBy) {
      const col = questions.find((x) => x.id === sortBy)
      if (col) {
        list = [...list].sort((a, b) => {
          const av = get(a.id, col)
          const bv = get(b.id, col)
          // スコアは数値、自由回答は文字列で比較。未回答は常に末尾。
          const an = av?.valueNum ?? null
          const bn = bv?.valueNum ?? null
          if (an !== null || bn !== null) {
            if (an === null) return 1
            if (bn === null) return -1
            return sortAsc ? an - bn : bn - an
          }
          // 自由回答は AI 判定（肯定 > ふつう > 否定）を優先して並べる。
          // 「肯定的に答えた人は誰か」を見たいので、五十音順より判定順のほうが役に立つ。
          const rank = (v?: AnswerData) =>
            v?.sentiment === 'positive' ? 2 : v?.sentiment === 'neutral' ? 1 : v?.sentiment === 'negative' ? 0 : null
          const ar = rank(av)
          const br = rank(bv)
          if (ar !== null || br !== null) {
            if (ar === null) return 1
            if (br === null) return -1
            if (ar !== br) return sortAsc ? ar - br : br - ar
          }
          const at = av?.valueText ?? ''
          const bt = bv?.valueText ?? ''
          if (!at) return 1
          if (!bt) return -1
          return sortAsc ? at.localeCompare(bt, 'ja') : bt.localeCompare(at, 'ja')
        })
      }
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, questions, sortBy, sortAsc, filter, cells])

  if (questions.length === 0 || sessions.length === 0) return null

  // 回答が1件も無いとき、黙って消えると「機能が無い」ように見えるので理由を出す。
  // 回答の構造化保存より前に実施したセッションは、回答が文字起こしの中にしか無い。
  // ここは意図的に excludedAt を見ない。抽出 API 側の対象条件が
  // 「Answer が1件も無いセッション」（excludedAt を問わない）なので、
  // ここだけ除外済みを未取得に数えると、押しても件数が減らないボタンになる。
  const answeredCount = sessions.filter((s) => (s.answers?.length ?? 0) > 0).length
  // 回答が入っていないセッション。1件でも埋まるとボタンが消えて
  // 残りを埋められなくなるため、テーブル表示中も導線を残す。
  const missingCount = sessions.length - answeredCount
  if (answeredCount === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-900 font-medium mb-1">回答の比較（質問 × 参加者）</p>
        <p className="text-xs text-gray-500 leading-relaxed max-w-lg mx-auto">
          このテストにはまだ質問ごとの回答が保存されていません。
          回答を個別に保存する仕組みを入れる前に実施したセッションは、回答が文字起こしの中にのみ残っています。
        </p>
        {onBackfill && (
          <button
            onClick={onBackfill}
            disabled={backfilling}
            className="mt-3 inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-3.5 py-2 rounded-md text-xs font-medium transition-colors"
          >
            {backfilling ? '抽出中…' : '文字起こしから回答を抽出する'}
          </button>
        )}
      </div>
    )
  }

  function toggleSort(qid: string) {
    if (sortBy === qid) { setSortAsc((v) => !v); return }
    setSortBy(qid)
    setSortAsc(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-auto">
          回答の比較（質問 × 参加者）
        </h2>
        <span className="text-[11px] text-gray-400 mr-auto">
          自由回答の肯定/否定は AI 判定（参考値）
        </span>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" strokeWidth={2} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="回答を絞り込む"
            aria-label="回答を絞り込む"
            className="bg-white border border-gray-300 focus:border-gray-900 rounded-md pl-8 pr-7 py-1.5 text-xs placeholder-gray-500 focus:outline-none transition-colors"
          />
          {filter && (
            <button onClick={() => setFilter('')} aria-label="絞り込みをクリア" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        {sortBy && (
          <button onClick={() => setSortBy(null)} className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2">
            並び替えを解除
          </button>
        )}
        {onBackfill && missingCount > 0 && (
          <button
            onClick={onBackfill}
            disabled={backfilling}
            className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 hover:text-gray-900 px-2.5 py-1.5 rounded-md text-xs transition-colors"
            title="回答が保存されていないセッションについて、文字起こしから回答を抽出します"
          >
            {backfilling ? '抽出中…' : `未取得 ${missingCount} 件を抽出`}
          </button>
        )}
      </div>

      {/* 横スクロール。参加者名の列は固定して、どの列を見ても誰の回答か分かるようにする */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-4 py-2.5 font-medium text-xs text-gray-600 w-36 min-w-36 border-r border-gray-200">
                参加者
              </th>
              {questions.map((q) => (
                <th key={q.id} className="text-left px-3 py-2.5 font-normal align-top min-w-[220px] max-w-[320px]">
                  <button
                    onClick={() => toggleSort(q.id)}
                    className="group text-left w-full"
                    title="この質問の回答で並び替える"
                  >
                    <span className="flex items-start gap-1.5">
                      <span className="text-[11px] text-gray-400 flex-shrink-0 pt-0.5">Q{q.order}</span>
                      <span className={`text-xs leading-snug ${sortBy === q.id ? 'text-gray-900 font-medium' : 'text-gray-600 group-hover:text-gray-900'}`}>
                        {q.text}
                      </span>
                      <ArrowUpDown
                        className={`w-3 h-3 flex-shrink-0 mt-0.5 ${sortBy === q.id ? 'text-gray-900' : 'text-gray-300 group-hover:text-gray-500'}`}
                        strokeWidth={2}
                      />
                    </span>
                    {q.type !== 'open' && (
                      <span className="text-[10px] text-gray-400 ml-6">
                        {q.type === 'nps' ? '0〜10' : '1〜5'}
                      </span>
                    )}
                    {/* どの画像についての回答かが分からないと、列同士を比べられない */}
                    {q.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={q.imageUrl}
                        alt=""
                        className="ml-6 mt-1 w-16 h-12 object-cover rounded border border-gray-200 bg-white"
                      />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50/60 align-top">
                <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200">
                  <Link href={`/dashboard/sessions/${s.id}`} className="text-sm text-gray-900 hover:underline underline-offset-2 break-words">
                    {s.participantName}
                  </Link>
                </td>
                {questions.map((q) => {
                  const a = get(s.id, q)
                  const cellKey = `${s.id}:${q.id}`
                  const isOpen = expanded === cellKey
                  if (!a) {
                    return <td key={q.id} className="px-3 py-3 text-xs text-gray-300">—</td>
                  }
                  if (typeof a.valueNum === 'number') {
                    return (
                      <td key={q.id} className="px-3 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded border text-xs font-semibold tabular-nums ${scoreTone(a.valueNum, a.type)}`}>
                          {a.valueNum}
                          <span className="font-normal opacity-70"> / {scaleMax(a.type)}</span>
                        </span>
                      </td>
                    )
                  }
                  const text = a.valueText ?? ''
                  const long = text.length > 90
                  const tone = a.sentiment ? SENTIMENT_BAR[a.sentiment] : ''
                  return (
                    <td key={q.id} className="px-3 py-3">
                      <div className={tone ? `${tone} pl-2` : ''}>
                        {a.sentiment && SENTIMENT_LABEL[a.sentiment] && (
                          <span
                            className={`inline-block mb-1 px-1.5 py-0.5 rounded border text-[10px] ${SENTIMENT_TONE[a.sentiment]}`}
                            title="AI による判定です。ニュアンスの取り違えがあるため、判断の前に本文をご確認ください"
                          >
                            {SENTIMENT_LABEL[a.sentiment]}
                          </span>
                        )}
                        <p className={`text-xs text-gray-700 leading-relaxed whitespace-pre-wrap ${isOpen || !long ? '' : 'line-clamp-3'}`}>
                          {text || <span className="text-gray-300">—</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {long && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : cellKey)}
                            className="text-[11px] text-gray-500 hover:text-gray-900 underline underline-offset-2"
                          >
                            {isOpen ? '折りたたむ' : 'すべて表示'}
                          </button>
                        )}
                        {(a.followUpCount ?? 0) > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] text-gray-500"
                            title="AI がこの質問をさらに掘り下げた回数。回答はまとめて1つのセルに入っています"
                          >
                            <MessageSquareMore className="w-3 h-3" strokeWidth={2} />
                            深掘り {a.followUpCount}回
                          </span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-gray-500">
          「{filter}」に一致する回答はありません
        </div>
      )}
    </div>
  )
}
