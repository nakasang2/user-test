import Link from 'next/link'

/**
 * プライバシーポリシー（枠）。
 * ⚠️ 本文は法務レビュー後に確定すること。以下は記載必須項目のプレースホルダー。
 * 改正個人情報保護法・GDPR を踏まえ、要配慮個人情報（顔・音声・感情推定）の
 * 取得目的・第三者提供・越境移転・保持期間・削除請求手段を明記する必要がある。
 */
export const metadata = { title: 'プライバシーポリシー | UserVoice' }

const SECTIONS: { heading: string; placeholder: string }[] = [
  {
    heading: '1. 取得する情報',
    placeholder:
      'カメラ映像・音声録画、画面録画、文字起こしテキスト、表情から推定したエンゲージメント指標、氏名・メールアドレス（任意）。',
  },
  {
    heading: '2. 利用目的',
    placeholder: '本ユーザーインタビュー調査の実施・分析・改善のためにのみ利用します。',
  },
  {
    heading: '3. 第三者提供・外部送信（越境移転）',
    placeholder:
      'AI による文字起こし・要約・分析のため、録画・テキストを外部AIサービス（例: OpenAI／米国）に送信します。送信先・移転先国・移転の根拠を明記すること。',
  },
  {
    heading: '4. 保持期間',
    placeholder: '録画・文字起こし・感情データの保持期間と、期間経過後の自動削除方針を明記すること。',
  },
  {
    heading: '5. 削除・利用停止の請求（データ主体の権利）',
    placeholder:
      '被験者は自身のデータの削除・利用停止を請求できます。請求窓口（連絡先）と対応方法を明記すること。',
  },
  {
    heading: '6. 共有リンク',
    placeholder:
      '調査結果は、トークン付きの読み取り専用リンクで関係者に共有される場合があります。リンクは管理者がいつでも停止（失効）でき、停止後は閲覧できません。共有範囲・停止方針を明記すること。',
  },
  {
    heading: '7. 管理者・問い合わせ先',
    placeholder: 'データ管理者の名称・連絡先を明記すること。',
  },
]

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← UserVoice</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-4 mb-2">プライバシーポリシー</h1>
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
