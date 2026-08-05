'use client'

import { useEffect, useState } from 'react'
import { X, Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react'
import ScreenerEditor, {
  findScreenerWithoutOptions,
  toScreenerPayload,
  type ScreenerRow,
} from './ScreenerEditor'
import SeqToggle from './SeqToggle'
import FollowUpToggle from '@/components/FollowUpToggle'
import { FOLLOW_UP_DEPTH_DEFAULT, normalizeFollowUpDepth } from '@/lib/follow-up'
import QuestionImageField from './QuestionImageField'
import { toQuestionImagePayload, validateQuestionImage } from '@/lib/question-image'

type QType = 'open' | 'rating' | 'nps'

export interface EditableInterview {
  id: string
  title: string
  description: string | null
  type: string
  seqEnabled?: boolean
  hintDelaySec?: number | null
  questions: { id: string; text: string; order: number; type: string; imageUrl?: string | null; imageMode?: string | null; imageDuration?: number | null; followUpEnabled?: boolean; followUpDepth?: number; naturalCapture?: boolean }[]
  tasks?: { id: string; text: string; order: number; hint?: string | null; isPrerequisite?: boolean | null }[]
  screeners?: { id: string; label: string; options: string[]; disqualify: string[]; required: boolean; order: number }[]
}

interface Row {
  /** 自由回答で AI が深掘りするか。未指定は true（従来どおり） */
  followUpEnabled?: boolean
  /** 深掘りの深さ */
  followUpDepth?: number
  id?: string
  text: string
  type: QType
  hint?: string
  isPrerequisite?: boolean
  // 印象テストで質問ごとに提示する画像
  imageUrl?: string | null
  imageMode?: string | null
  imageDuration?: number | null
  /** rating/nps でもボタンを出さず会話の中で自然に聞き、値は後で抽出する */
  naturalCapture?: boolean
}

const Q_TYPES: { value: QType; label: string }[] = [
  { value: 'open',   label: '自由回答' },
  { value: 'rating', label: '5段階評価' },
  { value: 'nps',    label: 'NPS（0〜10）' },
]

/**
 * 調査の編集。既存セッションがあっても編集できる（過去の回答は文言のスナップショットを
 * 持つため壊れない）が、途中で変えると集計が混ざるので警告は出す。
 */
export default function EditInterviewModal({
  interview,
  sessionCount,
  onClose,
  onSaved,
}: {
  interview: EditableInterview
  sessionCount: number
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(interview.title)
  const [description, setDescription] = useState(interview.description ?? '')
  const [questions, setQuestions] = useState<Row[]>(
    // 画像の3列を落とすと、保存のたびに設定が静かに消える（isPrerequisite で起きた事故と同じ）
    interview.questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: (q.type as QType) ?? 'open',
      imageUrl: q.imageUrl ?? null,
      followUpEnabled: q.followUpEnabled ?? true,
      followUpDepth: q.followUpDepth ?? FOLLOW_UP_DEPTH_DEFAULT,
      imageMode: q.imageMode ?? null,
      imageDuration: q.imageDuration ?? null,
      naturalCapture: q.naturalCapture ?? false,
    }))
  )
  const [tasks, setTasks] = useState<Row[]>(
    (interview.tasks ?? []).map((t) => ({
      id: t.id, text: t.text, type: 'open', hint: t.hint ?? '',
      isPrerequisite: t.isPrerequisite === true,
    }))
  )
  const [seqEnabled, setSeqEnabled] = useState(interview.seqEnabled ?? false)
  // 声かけまでの秒数。空欄なら声かけ自体を出さない
  // 1分未満が入っていると "0" になり、保存前ガードに弾かれてこの調査を一切保存できなくなる。
  // 最低1分に丸めて、少なくとも編集は続けられるようにする。
  const [hintDelayMin, setHintDelayMin] = useState(
    interview.hintDelaySec != null ? String(Math.max(1, Math.round(interview.hintDelaySec / 60))) : ''
  )
  const [screeners, setScreeners] = useState<ScreenerRow[]>(
    (interview.screeners ?? []).map((x) => ({
      id: x.id,
      label: x.label,
      optionsText: x.options.join('\n'),
      disqualifyText: x.disqualify.join('\n'),
      required: x.required,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isUsability = interview.type === 'usability'
  const isImpression = interview.type === 'impression'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (!title.trim()) { setError('タイトルを入力してください'); return }
    const badScreener = findScreenerWithoutOptions(screeners)
    if (badScreener) { setError(`事前質問「${badScreener}」に選択肢を入力してください`); return }
    if (isImpression) {
      for (let i = 0; i < questions.length; i++) {
        const bad = validateQuestionImage(questions[i], `質問${i + 1}`)
        if (bad) { setError(bad); return }
      }
    }
    // 範囲外のまま送るとサーバー側の英語エラーになり、同じ画面で直した他の項目
    // （タイトル・タスク・質問など）も一緒に保存されず消えてしまう。ここで止める。
    if (isUsability && hintDelayMin.trim()) {
      const m = Number(hintDelayMin)
      // 整数のみ。フォーム外の保存ボタン（設計ページ）ではブラウザ標準の step 検証が
      // 効かないため、3画面で受理される値が食い違わないよう JS 側でも弾く
      if (!Number.isInteger(m) || m < 1 || m > 30) {
        setError('声かけまでの時間は1〜30分で入力してください（空欄にすると声かけしません）')
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/interviews/${interview.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          questions: questions
            .filter((q) => q.text.trim())
            .map((q) => ({
              id: q.id, text: q.text.trim(), type: q.type,
              // 形式に関わらず設定をそのまま保存する。評価・NPS のときに true で
              // 上書きすると、一時的に形式を変えて戻しただけで OFF 設定が消える
              // （参加者側は rating/nps では元々深掘りしないので、上書きの実益もない）
              followUpEnabled: q.followUpEnabled !== false,
              followUpDepth: normalizeFollowUpDepth(q.followUpDepth),
              naturalCapture: q.naturalCapture === true,
              ...(isImpression ? toQuestionImagePayload(q) : {}),
            })),
          // 選択肢が無い設問は落とす（被験者が回答できず参加不能になるため）
          screeners: toScreenerPayload(screeners),
          ...(isUsability
            ? {
                tasks: tasks
                  .filter((t) => t.text.trim())
                  .map((t) => ({
                    id: t.id, text: t.text.trim(), hint: t.hint?.trim() || null,
                    isPrerequisite: t.isPrerequisite === true,
                  })),
                seqEnabled,
                // 空欄は「声かけしない」として null で送る。
                // 判定は上の保存前ガードと同じ条件にする（片方だけ緩いと、
                // ガードを触ったときに範囲外の値が通る余地が残る）
                hintDelaySec: (() => {
                  const m = Number(hintDelayMin)
                  return hintDelayMin.trim() && Number.isInteger(m) && m >= 1 && m <= 30 ? m * 60 : null
                })(),
              }
            : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '保存に失敗しました'); return }
      onSaved()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 削除扱いになる件数。行ごと消した場合に加え、文言を空にした行も保存時に落とされるため数える
  const isKept = (rows: Row[], id: string) => rows.some((r) => r.id === id && r.text.trim())
  const removedCount =
    interview.questions.filter((q) => !isKept(questions, q.id)).length +
    (interview.tasks ?? []).filter((t) => !isKept(tasks, t.id)).length

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-interview-title"
        className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl my-8"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 id="edit-interview-title" className="text-sm font-semibold text-gray-900">調査を編集</h2>
          <button onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[65vh] overflow-y-auto">
          {sessionCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <div className="leading-relaxed">
                このテストはすでに <strong>{sessionCount}件</strong> 実施済みです。実施済みの回答は残りますが、
                質問やタスクの<strong>追加・削除・並べ替え</strong>は、変更後に実施した分から集計が分かれます（過去の結果は元の項目のまま残ります）。文言の修正だけなら影響ありません。
              </div>
            </div>
          )}

          <div>
            <label htmlFor="edit-title" className="block text-xs font-medium text-gray-700 mb-1.5">タイトル</label>
            <input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-3 py-2 text-sm focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-desc" className="block text-xs font-medium text-gray-700 mb-1.5">説明（任意）</label>
            <textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-3 py-2 text-sm focus:outline-none resize-y"
            />
          </div>

          {isUsability && <SeqToggle checked={seqEnabled} onChange={setSeqEnabled} />}

          {isUsability && (
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <label htmlFor="edit-hint-delay" className="block text-xs font-medium text-gray-900 mb-1">
                詰まった参加者への声かけ
              </label>
              <p className="text-xs text-gray-600 leading-relaxed mb-2">
                タスクに着手してから指定した時間が経つと、「うまくいかないときは次に進めます」という案内を出します。
                タスクにヒントを書いておくと、そこから見られるようになります。
                <br />
                <span className="text-gray-500">空欄にすると声かけは出ません。</span>
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="edit-hint-delay"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={hintDelayMin}
                  onChange={(e) => setHintDelayMin(e.target.value)}
                  placeholder="3"
                  className="w-20 border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                />
                <span className="text-xs text-gray-600">分後に声かけする（1〜30分）</span>
              </div>
            </div>
          )}

          {isUsability && (
            <RowEditor
              label="タスク"
              rows={tasks}
              setRows={setTasks}
              placeholder="例: 作品を一つ選んでください"
              withType={false}
              withHint
            />
          )}

          <RowEditor
            label={isUsability ? '事後質問' : '質問'}
            rows={questions}
            setRows={setQuestions}
            placeholder="例: 使ってみて迷った点はありますか"
            withType
            withImage={isImpression}
            withFollowUp
            withNaturalCapture
          />

          {/* 事前質問（スクリーニング／属性）。作成・AI設計ページと共通のエディタ */}
          <ScreenerEditor rows={screeners} setRows={setScreeners} />

          {removedCount > 0 && (
            <p className="text-xs text-gray-500">
              {removedCount}件を削除します。実施済みの回答は残りますが、その項目の集計は今後増えません。
            </p>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button onClick={onClose} className="border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

/** 質問／タスクの共通エディタ（追加・削除・並べ替え） */
function RowEditor({
  label, rows, setRows, placeholder, withType, withHint = false, withImage = false, withFollowUp = false,
  withNaturalCapture = false,
}: {
  label: string
  rows: Row[]
  setRows: (r: Row[]) => void
  placeholder: string
  withType: boolean
  /** タスク用: 詰まったときに見せるヒントも入力する */
  withHint?: boolean
  /** 印象テストの質問用: 質問ごとに提示する画像も設定する */
  withImage?: boolean
  /** 質問用: 自由回答で AI が深掘りするかを選ぶ */
  withFollowUp?: boolean
  /** 質問用: rating/nps でもボタンを出さず会話の中で自然に聞くかを選ぶ */
  withNaturalCapture?: boolean
}) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setRows(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <button
          onClick={() => setRows([...rows, { text: '', type: 'open', followUpEnabled: true, followUpDepth: FOLLOW_UP_DEPTH_DEFAULT }])}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-2 py-1 rounded transition-colors"
        >
          <Plus className="w-3 h-3" strokeWidth={2} />追加
        </button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-gray-400">まだありません</p>}
        {rows.map((row, i) => (
          <div key={row.id ?? `new-${i}`}>
          <div className="flex items-start gap-1.5">
            <span className="text-xs text-gray-400 w-4 pt-2 flex-shrink-0">{i + 1}.</span>
            <input
              value={row.text}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)))}
              maxLength={2000}
              placeholder={placeholder}
              aria-label={`${label} ${i + 1}`}
              className="flex-1 border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
            />
            {withType && (
              <select
                value={row.type}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, type: e.target.value as QType } : r)))}
                aria-label={`${label} ${i + 1} の形式`}
                className="border border-gray-300 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-gray-900"
              >
                {Q_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
            <div className="flex flex-col">
              <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="上へ" className="text-gray-400 hover:text-gray-800 disabled:opacity-30 text-[10px] leading-none px-1">▲</button>
              <button onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label="下へ" className="text-gray-400 hover:text-gray-800 disabled:opacity-30 text-[10px] leading-none px-1">▼</button>
            </div>
            <button
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label={`${label} ${i + 1} を削除`}
              className="text-gray-400 hover:text-red-600 p-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
          {/* 深掘りの ON/OFF。自由回答のときだけ意味を持つ（評価・NPS は元々深掘りしない） */}
          {withFollowUp && row.type === 'open' && (
            <div className="flex items-start gap-1.5 mt-1">
              <span className="w-4 flex-shrink-0" aria-hidden="true" />
              <FollowUpToggle
                checked={row.followUpEnabled}
                depth={row.followUpDepth}
                questionNumber={i + 1}
                onChange={(next) => setRows(rows.map((r, j) => (j === i ? { ...r, followUpEnabled: next } : r)))}
                onDepthChange={(next) => setRows(rows.map((r, j) => (j === i ? { ...r, followUpDepth: next } : r)))}
              />
              <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
            </div>
          )}
          {/* rating/nps でも会話の中で自然に聞く。値は文字起こしから後で抽出する */}
          {withNaturalCapture && row.type !== 'open' && (
            <div className="flex items-start gap-1.5 mt-1">
              <span className="w-4 flex-shrink-0" aria-hidden="true" />
              <label className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-snug cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.naturalCapture === true}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, naturalCapture: e.target.checked } : r)))}
                  className="mt-0.5 flex-shrink-0"
                />
                <span>
                  ボタンではなく会話の中で自然に聞く
                  <span className="block text-gray-400">
                    参加者は自由に話して回答します。厳密な値は文字起こしからAIが後で抽出するため、稀に抽出できないことがあります
                  </span>
                </span>
              </label>
              <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
            </div>
          )}
          {withImage && (
            <div className="flex items-start gap-1.5 mt-1">
              <span className="w-4 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <QuestionImageField
                  value={row}
                  onChange={(patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
                />
              </div>
              <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
            </div>
          )}
          {withHint && (
            <>
              <div className="flex items-start gap-1.5 mt-1">
                <span className="w-4 flex-shrink-0" aria-hidden="true" />
                <input
                  value={row.hint ?? ''}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, hint: e.target.value } : r)))}
                  maxLength={2000}
                  placeholder={row.isPrerequisite
                    ? '操作の手順（例: 画面右上のハートを押すとお気に入りに入ります）'
                    : '詰まったときのヒント（任意）例: 画面右上のメニューから探せます'}
                  aria-label={`タスク ${i + 1} のヒント`}
                  className="flex-1 border border-dashed border-gray-300 focus:border-gray-900 focus:border-solid rounded-md px-2.5 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none"
                />
                <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
              </div>
              {/* 次のタスクの前提になるか。最後の行には出さない（次が無いので効かない） */}
              {i < rows.length - 1 && (
                <div className="flex items-start gap-1.5 mt-1">
                  <span className="w-4 flex-shrink-0" aria-hidden="true" />
                  <label className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-snug cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.isPrerequisite === true}
                      onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, isPrerequisite: e.target.checked } : r)))}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <span>
                      このタスクができていないと、次のタスクを始められない
                      <span className="block text-gray-400">
                        チェックすると、できなかった人に上のヒントを手順として見せ、次のタスクの開始地点まで案内します。案内しても到達できない場合、後続は「未実施」として記録し成功率の分母から外します
                      </span>
                    </span>
                  </label>
                  <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
                </div>
              )}
            </>
          )}
          </div>
        ))}
      </div>
    </div>
  )
}
