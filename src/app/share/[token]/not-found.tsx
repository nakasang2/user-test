import { Link2Off } from 'lucide-react'

export default function ShareNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Link2Off className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
        </div>
        <h1 className="text-base font-semibold text-gray-900 mb-1.5 tracking-tight">
          このレポートは表示できません
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          共有リンクが無効になったか、公開が停止された可能性があります。
          レポートの共有元にお問い合わせください。
        </p>
      </div>
    </div>
  )
}
