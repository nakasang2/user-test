'use client'

import { useEffect, useState } from 'react'
import { DESCRIPTION_TEMPLATES } from './description-templates'

export type SessionType = 'interview' | 'impression' | 'usability'

/**
 * 「テンプレートを挿入」で使う文言を組織のカスタム設定から取得する。
 * 未カスタマイズ（null）ならコード上の既定文言を返す。
 *
 * `loaded` が false の間はまだ組織のカスタム設定を確認できていない状態。
 * この間に「テンプレートを挿入」を押されると、カスタム設定があっても
 * 気づかず既定文言を挿入してしまうため、呼び出し側は loaded になるまで
 * 挿入ボタンを無効化すること。
 */
export function useDescriptionTemplates(): { templates: Record<SessionType, string>; loaded: boolean } {
  const [templates, setTemplates] = useState<Record<SessionType, string>>(DESCRIPTION_TEMPLATES)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/organizations/templates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data) {
          setTemplates({
            interview: data.templateInterview || DESCRIPTION_TEMPLATES.interview,
            impression: data.templateImpression || DESCRIPTION_TEMPLATES.impression,
            usability: data.templateUsability || DESCRIPTION_TEMPLATES.usability,
          })
        }
        // 取得に失敗しても既定文言のまま「読み込み済み」にする（挿入自体は止めない）
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  return { templates, loaded }
}
