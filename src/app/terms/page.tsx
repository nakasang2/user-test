import Link from 'next/link'

/**
 * 利用規約（枠）。本文は法務レビュー後に確定すること。
 */
export const metadata = { title: '利用規約 | UserVoice' }

const SECTIONS: { heading: string; placeholder: string }[] = [
  { heading: '1. 適用範囲', placeholder: '本規約の適用対象と範囲を明記すること。' },
  { heading: '2. 録画・AI 分析への同意', placeholder: '被験者の同意取得と撤回に関する条件を明記すること。' },
  { heading: '3. 禁止事項', placeholder: '不正利用・第三者の権利侵害などの禁止事項を明記すること。' },
  { heading: '4. 免責事項', placeholder: 'AI 生成結果の正確性に関する免責を明記すること。' },
  { heading: '5. 準拠法・管轄', placeholder: '準拠法および合意管轄を明記すること。' },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← UserVoice</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-4 mb-2">利用規約</h1>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-8">
          ⚠️ 本ページは枠（ドラフト）です。本文は法務レビュー後に確定してください。
        </p>
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.heading}>
              <h2 className="text-base font-medium mb-2">{s.heading}</h2>
              <p className="text-sm text-gray-500 leading-relaxed">{s.placeholder}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
