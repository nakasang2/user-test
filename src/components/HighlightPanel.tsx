'use client'

import { useState } from 'react'
import { Highlighter, Trash2, Tag as TagIcon, Check, X, Play } from 'lucide-react'

export interface HighlightData {
  id: string
  segmentId: string | null
  quote: string
  note: string | null
  tags: string[]
  startTime: number | null
  createdAt: string
}

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * リサーチャーが付けたハイライト（引用＋メモ＋タグ）の一覧・編集。
 * 定性分析のコーディング用。AI が生成するテーマと違い、人の解釈を残す場所。
 */
export default function HighlightPanel({
  highlights,
  onUpdate,
  onDelete,
  onSeek,
}: {
  highlights: HighlightData[]
  onUpdate: (id: string, patch: { note?: string; tags?: string[] }) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSeek?: (sec: number) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [busy, setBusy] = useState(false)

  function startEdit(h: HighlightData) {
    setEditingId(h.id)
    setDraftNote(h.note ?? '')
    setDraftTags(h.tags.join(', '))
  }

  async function save(id: string) {
    setBusy(true)
    try {
      await onUpdate(id, {
        note: draftNote,
        tags: draftTags.split(',').map((t) => t.trim()).filter(Boolean),
      })
      setEditingId(null)
    } finally {
      setBusy(false)
    }
  }

  if (highlights.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
        <Highlighter className="w-5 h-5 text-gray-400 mx-auto mb-2" strokeWidth={1.75} />
        <p className="text-sm text-gray-700 mb-1">ハイライトはまだありません</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          会話ログの各発言にある「引用」ボタンから、注目した発言にメモとタグを付けられます。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">ハイライト</h3>
        <span className="text-xs text-gray-500">{highlights.length} 件</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {highlights.map((h) => (
          <li key={h.id} className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <blockquote className="flex-1 text-sm text-gray-900 leading-relaxed border-l-2 border-yellow-400 pl-2.5">
                {h.quote}
              </blockquote>
              <div className="flex items-center gap-1 flex-shrink-0">
                {h.startTime != null && onSeek && (
                  <button
                    onClick={() => onSeek(h.startTime!)}
                    title="この位置から動画を再生"
                    aria-label="この位置から動画を再生"
                    className="text-gray-400 hover:text-gray-900 p-1 rounded transition-colors inline-flex items-center gap-0.5"
                  >
                    <Play className="w-3 h-3" strokeWidth={2} />
                    <span className="text-[11px] tabular-nums">{formatTime(h.startTime)}</span>
                  </button>
                )}
                <button
                  onClick={() => onDelete(h.id)}
                  title="削除"
                  aria-label="ハイライトを削除"
                  className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>

            {editingId === h.id ? (
              <div className="space-y-2">
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  rows={2}
                  placeholder="メモ（なぜ重要か、示唆は何か）"
                  aria-label="メモ"
                  className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-xs focus:outline-none resize-y"
                />
                <input
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="タグ（カンマ区切り: 価格, 導線の迷い）"
                  aria-label="タグ"
                  className="w-full border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => save(h.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-2.5 py-1 rounded text-xs font-medium transition-colors"
                  >
                    <Check className="w-3 h-3" strokeWidth={2.5} />保存
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="inline-flex items-center gap-1 border border-gray-300 hover:border-gray-400 text-gray-700 px-2.5 py-1 rounded text-xs transition-colors"
                  >
                    <X className="w-3 h-3" strokeWidth={2} />キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {h.note && <p className="text-xs text-gray-600 leading-relaxed">{h.note}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  {h.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 border border-gray-200 px-1.5 py-0.5 rounded text-[11px]">
                      <TagIcon className="w-2.5 h-2.5" strokeWidth={2} />{t}
                    </span>
                  ))}
                  <button
                    onClick={() => startEdit(h)}
                    className="text-[11px] text-gray-500 hover:text-gray-900 underline underline-offset-2"
                  >
                    {h.note || h.tags.length ? 'メモ・タグを編集' : 'メモ・タグを追加'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
