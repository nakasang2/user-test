'use client'

import { useState } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

/**
 * 複数選択した項目をまとめて削除する前の確認ダイアログ。
 *
 * 対象の名前を列挙して「何を消すか」を具体的に見せる（件数だけだと
 * 選択ミスに気づけない）。録画・画像もサーバー側で削除されることを明記する。
 * 一括削除は調査単体の削除（テスト名を入力させる方式）より軽いフローだが、
 * 対象一覧を必ず見せることで代わりの確認とする。
 */
export default function BulkDeleteModal({
  itemLabel,
  items,
  detailNote,
  deleting,
  onConfirm,
  onClose,
}: {
  /** 「テスト」「セッション」など、確認文言に出す対象の呼び名 */
  itemLabel: string
  items: { id: string; label: string }[]
  /** 録画・画像も消える旨など、対象固有の注意書き */
  detailNote: string
  deleting: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? items : items.slice(0, 8)

  return (
    <div
      className="fixed inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-gray-200 rounded-xl shadow-xl w-full max-w-md"
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 id="bulk-delete-title" className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-red-600" strokeWidth={2} />
            {items.length}件の{itemLabel}を削除しますか？
          </h2>
          <button onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 leading-relaxed">
            {detailNote}元に戻せません。
          </p>

          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {visibleItems.map((it) => (
              <p key={it.id} className="px-3 py-1.5 text-xs text-gray-700 truncate">{it.label}</p>
            ))}
          </div>
          {!expanded && items.length > visibleItems.length && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
            >
              残り {items.length - visibleItems.length} 件を表示
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={deleting}
            className="border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
            {deleting ? '削除中…' : `${items.length}件を削除する`}
          </button>
        </div>
      </div>
    </div>
  )
}
