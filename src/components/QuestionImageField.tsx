'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { ImagePlus, Link2, Loader2, X } from 'lucide-react'
import {
  IMAGE_MODE_LABELS,
  MIN_IMAGE_DURATION,
  MAX_IMAGE_DURATION,
  DEFAULT_IMAGE_DURATION,
  normalizeImageMode,
  type QuestionImageInput,
} from '@/lib/question-image'

/**
 * 質問1件に紐づける画像の設定（印象テスト用）。
 *
 * 作成モーダル・編集モーダル・AI 設計ページの3画面で使う。3か所に同じフォームを
 * 書くと、受理される値や文言が画面ごとにずれる（声かけの分数で実際に起きた）。
 *
 * 画像は「アップロード」と「URL 貼り付け」の両方を受け付ける。未公開のデザイン案は
 * どこかに公開して URL を作るのが手間なので、アップロードを既定の導線にする。
 */
export default function QuestionImageField({
  value,
  onChange,
  disabled,
}: {
  value: QuestionImageInput
  onChange: (patch: QuestionImageInput) => void
  disabled?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [urlMode, setUrlMode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mode = normalizeImageMode(value.imageMode)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      // ブラウザから Blob へ直接上げる（サーバーレス関数のボディ制限を回避）。
      // 被験者は未ログインで <img> から読むので公開設定にする
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/uploads/question-image',
      })
      onChange({ ...value, imageUrl: blob.url })
    } catch {
      setError('画像をアップロードできませんでした。10MB 以下の PNG / JPEG / WebP / GIF をお試しください。')
    } finally {
      setUploading(false)
      // 同じファイルを選び直せるようにする
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!value.imageUrl) {
    return (
      <div className="space-y-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          className="hidden"
        />
        {urlMode ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              type="url"
              placeholder="https://example.com/design.png"
              disabled={disabled}
              onChange={(e) => onChange({ ...value, imageUrl: e.target.value })}
              aria-label="画像URL"
              className="flex-1 min-w-0 border border-gray-300 focus:border-gray-900 rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setUrlMode(false)}
              className="text-xs text-gray-500 hover:text-gray-900 px-1.5"
            >
              やめる
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 border border-dashed border-gray-300 hover:border-gray-900 disabled:opacity-50 text-gray-600 hover:text-gray-900 px-2 py-1 rounded text-[11px] transition-colors"
            >
              {uploading
                ? <><Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />アップロード中…</>
                : <><ImagePlus className="w-3 h-3" strokeWidth={2} />画像を追加</>}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setUrlMode(true)}
              className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition-colors"
            >
              <Link2 className="w-3 h-3" strokeWidth={2} />
              URLで指定
            </button>
          </div>
        )}
        {error && <p className="text-[11px] text-red-600 leading-relaxed">{error}</p>}
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-md p-2 space-y-2 bg-gray-50">
      <div className="flex items-start gap-2">
        {/* 取り違え防止のため実物を出す。next/image は外部ドメインの設定が要るので使わない */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value.imageUrl}
          alt="この質問で提示する画像"
          className="w-16 h-16 object-cover rounded border border-gray-200 bg-white flex-shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <select
            value={mode}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, imageMode: e.target.value })}
            aria-label="画像の見せ方"
            className="w-full bg-white border border-gray-300 focus:border-gray-900 rounded-md px-2 py-1 text-[11px] focus:outline-none"
          >
            <option value="persistent">{IMAGE_MODE_LABELS.persistent}</option>
            <option value="timed">{IMAGE_MODE_LABELS.timed}</option>
          </select>
          {mode === 'timed' && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={MIN_IMAGE_DURATION}
                max={MAX_IMAGE_DURATION}
                step={1}
                disabled={disabled}
                value={value.imageDuration ?? ''}
                placeholder={String(DEFAULT_IMAGE_DURATION)}
                onChange={(e) =>
                  onChange({ ...value, imageDuration: e.target.value === '' ? null : Number(e.target.value) })
                }
                aria-label="画像の表示秒数"
                className="w-16 bg-white border border-gray-300 focus:border-gray-900 rounded-md px-2 py-1 text-[11px] focus:outline-none"
              />
              <span className="text-[11px] text-gray-600">
                秒だけ見せて隠す（{MIN_IMAGE_DURATION}〜{MAX_IMAGE_DURATION}・空欄は{DEFAULT_IMAGE_DURATION}秒）
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, imageUrl: null, imageMode: null, imageDuration: null })}
          aria-label="画像を外す"
          title="画像を外す"
          className="text-gray-400 hover:text-red-600 p-1 flex-shrink-0 transition-colors"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
