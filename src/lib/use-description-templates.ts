'use client'

import { useEffect, useState } from 'react'
import { DESCRIPTION_TEMPLATES } from './description-templates'

export type SessionType = 'interview' | 'impression' | 'usability'

/**
 * 「テンプレートを挿入」で使う文言を組織のカスタム設定から取得する。
 * 未カスタマイズ（null）またはまだ読み込めていない間は、コード上の既定文言を返す。
 * 組織設定は /dashboard/settings/templates で編集する。
 */
export function useDescriptionTemplates(): Record<SessionType, string> {
  const [templates, setTemplates] = useState<Record<SessionType, string>>(DESCRIPTION_TEMPLATES)

  useEffect(() => {
    let cancelled = false
    fetch('/api/organizations/templates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setTemplates({
          interview: data.templateInterview || DESCRIPTION_TEMPLATES.interview,
          impression: data.templateImpression || DESCRIPTION_TEMPLATES.impression,
          usability: data.templateUsability || DESCRIPTION_TEMPLATES.usability,
        })
      })
      .catch(() => {
        // 取得に失敗しても既定文言のままボタンは使える（挿入自体を止めない）
      })
    return () => { cancelled = true }
  }, [])

  return templates
}
