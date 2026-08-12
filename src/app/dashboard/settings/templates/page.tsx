'use client'

import { useState, useEffect } from 'react'
import { DESCRIPTION_TEMPLATES } from '@/lib/description-templates'

type SessionType = 'interview' | 'impression' | 'usability'

const LABELS: Record<SessionType, string> = {
  interview: 'インタビュー',
  impression: '印象テスト',
  usability: 'ユーザビリティテスト',
}

const TYPES: SessionType[] = ['interview', 'impression', 'usability']

export default function TemplatesSettingsPage() {
  // null = 未カスタマイズ（既定文言を使う）
  const [values, setValues] = useState<Record<SessionType, string | null>>({
    interview: null, impression: null, usability: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/organizations/templates')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setError('テンプレートの取得に失敗しました'); return }
        const data = await res.json()
        setValues({
          interview: data.templateInterview ?? null,
          impression: data.templateImpression ?? null,
          usability: data.templateUsability ?? null,
        })
        setViewerRole(data.viewerRole ?? null)
      })
      .catch(() => { if (!cancelled) setError('ネットワークエラーが発生しました') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 書き込みの認可はサーバー（admin+）が最終判断する。ここは押しても必ず403になる
  // ボタンを見せないための表示上の分岐（api-auth.ts の getRole と同じ考え方）
  const canEdit = viewerRole === 'admin' || viewerRole === 'owner'

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/organizations/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateInterview: values.interview,
          templateImpression: values.impression,
          templateUsability: values.usability,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { alert(data.error ?? '保存に失敗しました'); return }
      setValues({
        interview: data.templateInterview ?? null,
        impression: data.templateImpression ?? null,
        usability: data.templateUsability ?? null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      alert('通信エラーが発生しました。時間をおいて再度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-gray-500 hover:text-gray-900 text-sm">← ダッシュボード</a>
          <span className="text-gray-300">/</span>
          <h1 className="text-lg font-semibold tracking-tight">説明テンプレート</h1>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          テスト作成画面の「テンプレートを挿入」ボタンで入力される文言です。空欄のまま保存すると、既定の文言（プレースホルダーに表示中のもの）が使われます。
          ここでの変更は組織内の全員に反映されます。
        </p>

        {!canEdit && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            閲覧のみ可能です。編集・保存には管理者権限が必要です。
          </p>
        )}

        <div className="space-y-6">
          {TYPES.map((type) => (
            <section key={type} className="bg-white border border-gray-200 rounded-lg p-5 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor={`tpl-${type}`} className="text-sm font-semibold tracking-tight text-gray-900">
                  {LABELS[type]}
                </label>
                {canEdit && values[type] !== null && (
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [type]: null }))}
                    className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
                  >
                    既定文言に戻す
                  </button>
                )}
              </div>
              <textarea
                id={`tpl-${type}`}
                value={values[type] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [type]: e.target.value }))}
                placeholder={DESCRIPTION_TEMPLATES[type]}
                rows={4}
                disabled={!canEdit}
                className="w-full bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-500 resize-y"
              />
            </section>
          ))}
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
            {saved && <span className="text-sm text-emerald-700">保存しました</span>}
          </div>
        )}
      </div>
    </div>
  )
}
