'use client'

import { useEffect, useState } from 'react'
import { X, Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react'

type QType = 'open' | 'rating' | 'nps'

export interface EditableInterview {
  id: string
  title: string
  description: string | null
  type: string
  seqEnabled?: boolean
  hintDelaySec?: number | null
  questions: { id: string; text: string; order: number; type: string }[]
  tasks?: { id: string; text: string; order: number; hint?: string | null }[]
  screeners?: { id: string; label: string; options: string[]; disqualify: string[]; required: boolean; order: number }[]
}

interface ScreenerRow {
  id?: string
  label: string
  optionsText: string     // 改行区切りで編集する
  disqualifyText: string  // 改行区切り。ここに書いた選択肢を選んだ人は参加不可
  required: boolean
}

interface Row { id?: string; text: string; type: QType; hint?: string }

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
    interview.questions.map((q) => ({ id: q.id, text: q.text, type: (q.type as QType) ?? 'open' }))
  )
  const [tasks, setTasks] = useState<Row[]>(
    (interview.tasks ?? []).map((t) => ({ id: t.id, text: t.text, type: 'open', hint: t.hint ?? '' }))
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (!title.trim()) { setError('タイトルを入力してください'); return }
    const badScreener = screeners.find((x) => x.label.trim() && !x.optionsText.split('\n').some((o) => o.trim()))
    if (badScreener) { setError(`事前質問「${badScreener.label.trim()}」に選択肢を入力してください`); return }
    // 範囲外のまま送るとサーバー側の英語エラーになり、同じ画面で直した他の項目
    // （タイトル・タスク・質問など）も一緒に保存されず消えてしまう。ここで止める。
    if (isUsability && hintDelayMin.trim()) {
      const m = Number(hintDelayMin)
      if (!Number.isFinite(m) || m < 1 || m > 30) {
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
            .map((q) => ({ id: q.id, text: q.text.trim(), type: q.type })),
          screeners: screeners
            // 選択肢が無い設問は保存しない（被験者が回答できず参加不能になるため）
            .filter((x) => x.label.trim() && x.optionsText.split('\n').some((o) => o.trim()))
            .map((x) => ({
              id: x.id,
              label: x.label.trim(),
              options: x.optionsText.split('\n').map((o) => o.trim()).filter(Boolean),
              disqualify: x.disqualifyText.split('\n').map((o) => o.trim()).filter(Boolean),
              required: x.required,
            })),
          ...(isUsability
            ? {
                tasks: tasks
                  .filter((t) => t.text.trim())
                  .map((t) => ({ id: t.id, text: t.text.trim(), hint: t.hint?.trim() || null })),
                seqEnabled,
                // 空欄・0以下は「声かけしない」として null で送る
                hintDelaySec: (() => {
                  const m = Number(hintDelayMin)
                  return hintDelayMin.trim() && Number.isFinite(m) && m > 0 ? Math.round(m * 60) : null
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

          {isUsability && (
            <label className="flex items-start gap-2 cursor-pointer bg-gray-50 border border-gray-200 rounded-md p-3">
              <input
                type="checkbox"
                checked={seqEnabled}
                onChange={(e) => setSeqEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-gray-700 leading-relaxed">
                <span className="font-medium text-gray-900">各タスクの直後に「どれくらい簡単でしたか」を聞く（SEQ）</span>
                <br />
                1〜7 の7段階。成功率だけでは見えない「できたけれど、つらかった」タスクを拾えます。
              </span>
            </label>
          )}

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
          />

          {/* 事前質問（スクリーニング／属性） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-700">事前質問（参加前に聞く属性・条件）</span>
              <button
                onClick={() => setScreeners([...screeners, { label: '', optionsText: '', disqualifyText: '', required: true }])}
                className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-2 py-1 rounded transition-colors"
              >
                <Plus className="w-3 h-3" strokeWidth={2} />追加
              </button>
            </div>
            {screeners.length === 0 && (
              <p className="text-xs text-gray-400">なし（全員が参加できます）</p>
            )}
            <div className="space-y-3">
              {screeners.map((sc, i) => (
                <div key={sc.id ?? `new-${i}`} className="border border-gray-200 rounded-md p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      value={sc.label}
                      onChange={(e) => setScreeners(screeners.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                      placeholder="質問文（例: このサービスを使ったことがありますか）"
                      aria-label={`事前質問 ${i + 1}`}
                      className="flex-1 border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                    />
                    <button
                      onClick={() => setScreeners(screeners.filter((_, j) => j !== i))}
                      aria-label={`事前質問 ${i + 1} を削除`}
                      className="text-gray-400 hover:text-red-600 p-1.5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">選択肢（1行に1つ）</label>
                      <textarea
                        value={sc.optionsText}
                        onChange={(e) => setScreeners(screeners.map((r, j) => (j === i ? { ...r, optionsText: e.target.value } : r)))}
                        rows={3}
                        placeholder={'はい\nいいえ'}
                        className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-2 py-1.5 text-xs focus:outline-none resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">
                        参加不可にする選択肢
                      </label>
                      <textarea
                        value={sc.disqualifyText}
                        onChange={(e) => setScreeners(screeners.map((r, j) => (j === i ? { ...r, disqualifyText: e.target.value } : r)))}
                        rows={3}
                        placeholder={'（空なら全員参加可）'}
                        className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-2 py-1.5 text-xs focus:outline-none resize-y"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sc.required}
                      onChange={(e) => setScreeners(screeners.map((r, j) => (j === i ? { ...r, required: e.target.checked } : r)))}
                    />
                    回答必須
                  </label>
                </div>
              ))}
            </div>
            {screeners.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                「参加不可にする選択肢」に書いた回答を選んだ人は、セッションを作らずに丁重にお断りします。
                条件は被験者側には表示されません。
              </p>
            )}
          </div>

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
  label, rows, setRows, placeholder, withType, withHint = false,
}: {
  label: string
  rows: Row[]
  setRows: (r: Row[]) => void
  placeholder: string
  withType: boolean
  /** タスク用: 詰まったときに見せるヒントも入力する */
  withHint?: boolean
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
          onClick={() => setRows([...rows, { text: '', type: 'open' }])}
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
          {withHint && (
            <div className="flex items-start gap-1.5 mt-1">
              <span className="w-4 flex-shrink-0" aria-hidden="true" />
              <input
                value={row.hint ?? ''}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, hint: e.target.value } : r)))}
                placeholder="詰まったときのヒント（任意）例: 画面右上のメニューから探せます"
                aria-label={`タスク ${i + 1} のヒント`}
                className="flex-1 border border-dashed border-gray-300 focus:border-gray-900 focus:border-solid rounded-md px-2.5 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none"
              />
              <span className="w-[52px] flex-shrink-0" aria-hidden="true" />
            </div>
          )}
          </div>
        ))}
      </div>
    </div>
  )
}
