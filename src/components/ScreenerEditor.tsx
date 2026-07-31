'use client'

import { Plus, Trash2 } from 'lucide-react'

/**
 * 事前質問（スクリーニング／属性）のエディタ。
 *
 * 作成モーダル・編集モーダル・AI 設計ページの3画面で使う。
 * 3か所に同じフォームを書くと、受理される値や文言が画面ごとにずれるため共有する
 * （声かけまでの分数で実際に起きた。DECISIONS の「3画面で受理される値が食い違わないよう」参照）。
 *
 * 属性はセグメント分析（「初心者だけの成功率」）の軸になるので、
 * 参加不可条件を使わない調査でも設定する価値がある。
 */
export interface ScreenerRow {
  id?: string
  label: string
  optionsText: string     // 改行区切りで編集する
  disqualifyText: string  // 改行区切り。ここに書いた選択肢を選んだ人は参加不可
  required: boolean
}

export const emptyScreener = (): ScreenerRow => ({
  label: '',
  optionsText: '',
  disqualifyText: '',
  required: true,
})

const lines = (v: string) => v.split('\n').map((o) => o.trim()).filter(Boolean)

/**
 * 保存前の検証。選択肢が無い設問があれば、その質問文を返す（無ければ null）。
 * 選択肢ゼロだと被験者が回答できず、必須なら誰も参加できなくなる。
 */
export function findScreenerWithoutOptions(rows: ScreenerRow[]): string | null {
  const bad = rows.find((x) => x.label.trim() && lines(x.optionsText).length === 0)
  return bad ? bad.label.trim() : null
}

/** API に送る形へ変換する。質問文が空の行と、選択肢が無い行は落とす */
export function toScreenerPayload(rows: ScreenerRow[]) {
  return rows
    .filter((x) => x.label.trim() && lines(x.optionsText).length > 0)
    .map((x) => ({
      id: x.id,
      label: x.label.trim(),
      options: lines(x.optionsText),
      disqualify: lines(x.disqualifyText),
      required: x.required,
    }))
}

export default function ScreenerEditor({
  rows,
  setRows,
}: {
  rows: ScreenerRow[]
  setRows: (rows: ScreenerRow[]) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-700">事前質問（参加前に聞く属性・条件）</span>
        <button
          type="button"
          onClick={() => setRows([...rows, emptyScreener()])}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-2 py-1 rounded transition-colors"
        >
          <Plus className="w-3 h-3" strokeWidth={2} />追加
        </button>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-gray-400 leading-relaxed">
          なし（全員が参加できます）。
          ここで聞いた回答は属性として保存され、結果ページで「この属性の人だけ」に絞って集計できます。
        </p>
      )}
      <div className="space-y-3">
        {rows.map((sc, i) => (
          <div key={sc.id ?? `new-${i}`} className="border border-gray-200 rounded-md p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                value={sc.label}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                placeholder="質問文（例: このサービスを使ったことがありますか）"
                aria-label={`事前質問 ${i + 1}`}
                className="flex-1 border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
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
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, optionsText: e.target.value } : r)))}
                  rows={3}
                  placeholder={'はい\nいいえ'}
                  className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-2 py-1.5 text-xs focus:outline-none resize-y"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">参加不可にする選択肢</label>
                <textarea
                  value={sc.disqualifyText}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, disqualifyText: e.target.value } : r)))}
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
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, required: e.target.checked } : r)))}
              />
              回答必須
            </label>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
          「参加不可にする選択肢」に書いた回答を選んだ人は、セッションを作らずに丁重にお断りします。
          条件は被験者側には表示されません。回答は属性として保存され、結果ページのセグメント絞り込みに使えます。
        </p>
      )}
    </div>
  )
}
