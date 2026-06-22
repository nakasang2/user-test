'use client'

import { Printer } from 'lucide-react'

/** ブラウザの印刷ダイアログを開く（PDF 保存にも利用可能）。印刷時は no-print 要素を非表示にする */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm transition-colors"
    >
      <Printer className="w-3.5 h-3.5" strokeWidth={2} />
      印刷 / PDF 保存
    </button>
  )
}
