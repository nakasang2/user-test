'use client'

/**
 * SEQ（Single Ease Question）— タスク直後に主観的な易しさを 1〜7 で聞く。
 * ユーザビリティテストの標準手法で、成功率だけでは見えない
 * 「できたけれど、つらかった」タスクを拾うために使う。
 */
export default function SeqScale({
  onSelect,
  compact = false,
}: {
  onSelect: (value: number) => void
  compact?: boolean
}) {
  return (
    <div className="space-y-2">
      <p className={`text-gray-900 font-medium leading-snug ${compact ? 'text-xs' : 'text-sm'}`}>
        今の操作はどれくらい簡単でしたか？
      </p>
      <div className="flex gap-1" role="group" aria-label="操作の簡単さを1〜7で評価">
        {[1, 2, 3, 4, 5, 6, 7].map((v) => (
          <button
            key={v}
            onClick={() => onSelect(v)}
            aria-label={`${v}${v === 1 ? '（とても難しい）' : v === 7 ? '（とても簡単）' : ''}`}
            className={`flex-1 border border-gray-300 hover:border-gray-900 hover:bg-gray-900 hover:text-white text-gray-700 rounded transition-colors font-medium ${
              compact ? 'py-1.5 text-xs' : 'py-2 text-sm'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>とても難しい</span>
        <span>とても簡単</span>
      </div>
    </div>
  )
}
