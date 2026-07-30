'use client'

import { MessageCircle } from 'lucide-react'

/**
 * 思考発話（think-aloud）の促し。黙って操作が続いたときだけ出す。
 *
 * 「うまくできているか」を問う文言にしないこと。評価されていると感じると
 * 参加者は本音ではなく、正しそうな言葉を探して話し始める。
 * 聞きたいのは迷いや期待のズレなので、いま頭にあることをそのまま口に出せる
 * 言い方（「何を考えていますか」）にしている。
 *
 * 同時に声（TTS）でも同じことを伝える。参加者は別タブのサービスを見ているので、
 * 小窓の表示だけでは気づけない。
 */
export default function ThinkAloudNudge({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="status"
      className={`bg-indigo-50 border border-indigo-200 rounded-lg ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <p className={`flex items-start gap-1.5 text-indigo-900 leading-snug ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <MessageCircle className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 mt-px`} strokeWidth={2} />
        <span>
          いま何を考えていますか？
          <span className="block text-indigo-800/80 mt-0.5">
            思っていることを、そのまま声に出してみてください。うまく言えなくても大丈夫です。
          </span>
        </span>
      </p>
    </div>
  )
}
