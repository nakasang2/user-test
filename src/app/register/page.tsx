import Link from 'next/link'
import { Mail } from 'lucide-react'

/**
 * 社内利用のみのため、新しい組織を誰でも作れる公開登録は廃止した。
 * 新しいメンバーは既存組織のオーナー/管理者からの招待（/invite/[token]）経由でのみ参加できる。
 */
export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1 tracking-tight">UserVoice</h1>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center space-y-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
            <Mail className="w-5 h-5 text-gray-500" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            現在、新規登録は管理者からの招待制です。<br />
            利用を希望される場合は、組織の管理者に招待をご依頼ください。
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full bg-gray-900 hover:bg-gray-800 text-white px-4 py-2.5 rounded-md text-sm font-medium transition-colors"
          >
            ログインへ
          </Link>
        </div>
      </div>
    </div>
  )
}
