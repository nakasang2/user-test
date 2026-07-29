'use client'

import { Lightbulb, LifeBuoy } from 'lucide-react'

/**
 * 詰まった参加者への声かけ。
 *
 * ユーザビリティテストでは、参加者が「自分が悪い」と感じて延々と粘るか、
 * 何も言わずに離脱してしまうことがある。どちらも結果として得られる情報が減る。
 * そこで一定時間そのタスクに留まっていたら、
 *   1. うまくいかないこと自体が発見であること（＝あなたのせいではない）
 *   2. 次に進んでよいこと
 * を明示し、リサーチャーが用意したヒントがあれば見られるようにする。
 *
 * ヒントは調査ごとに固定の文言なので、全員が同じ助けを受ける。
 * その場でAIが即興の助言をする方式にしないのは、人によって受ける助けが変わると
 * 参加者間の比較ができなくなるため。
 *
 * ヒントを見たかどうかは呼び出し側が記録し、集計では「自力の達成」と分ける。
 */
export default function StuckHelp({
  hint,
  hintShown,
  onRevealHint,
  compact = false,
}: {
  /** リサーチャーが書いたヒント。無ければ案内のみ出す */
  hint: string | null
  hintShown: boolean
  onRevealHint: () => void
  /** 小窓など幅の狭い場所向け */
  compact?: boolean
}) {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg ${compact ? 'p-2.5' : 'p-3'} space-y-2`}>
      <p className={`flex items-start gap-1.5 text-blue-900 leading-snug ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <LifeBuoy className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 mt-px`} strokeWidth={2} />
        <span>
          うまく進まないときは、そのまま
          <span className="font-semibold">「できなかった」</span>
          で次へ進んでかまいません。
          <span className="block text-blue-800/80 mt-0.5">
            うまくいかないこと自体が、私たちにとって大事な発見です。
          </span>
        </span>
      </p>

      {hint && !hintShown && (
        <button
          onClick={onRevealHint}
          className={`w-full inline-flex items-center justify-center gap-1.5 bg-white border border-blue-300 hover:border-blue-500 text-blue-800 rounded-md transition-colors ${
            compact ? 'py-1.5 text-[11px]' : 'py-2 text-xs'
          }`}
        >
          <Lightbulb className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} strokeWidth={2} />
          ヒントを見る
        </button>
      )}

      {hint && hintShown && (
        <div className={`bg-white border border-blue-200 rounded-md ${compact ? 'p-2' : 'p-2.5'}`}>
          <p className={`flex items-center gap-1.5 text-blue-700 font-medium mb-1 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            <Lightbulb className="w-3 h-3" strokeWidth={2} />
            ヒント
          </p>
          <p className={`text-gray-900 leading-relaxed whitespace-pre-line ${compact ? 'text-[11px]' : 'text-xs'}`}>
            {hint}
          </p>
        </div>
      )}
    </div>
  )
}
