'use client'

import { useState } from 'react'

/**
 * NPS（0〜10）の質問。
 *
 * メイン画面と小窓（service モードの事後質問）の両方から使う。共通化の理由は
 * RatingQuestion と同じ。
 *
 * compact は小窓のような幅の狭い場所向け。
 */
export default function NpsQuestion({
  question,
  onSubmit,
  compact = false,
}: {
  question: string
  onSubmit: (v: number) => void
  compact?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div className={`text-center w-full ${compact ? '' : 'max-w-lg'}`}>
      <p className={`text-gray-700 leading-relaxed ${compact ? 'text-xs mb-3' : 'text-sm mb-5'}`}>{question}</p>
      <div className={`flex justify-center flex-wrap ${compact ? 'gap-1 mb-2' : 'gap-1 mb-2.5'}`}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => {
          const color = v <= 6 ? 'border-red-200 text-red-700 hover:bg-red-50'
            : v <= 8 ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
            : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          return (
            <button
              key={v}
              onMouseEnter={() => setHovered(v)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSubmit(v)}
              className={`rounded-md font-medium transition-all bg-white border ${
                compact ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-sm'
              } ${color} ${hovered === v ? 'scale-110' : ''}`}
            >
              {v}
            </button>
          )
        })}
      </div>
      <div className={`flex justify-between text-gray-500 mx-auto ${compact ? 'text-[10px] max-w-[220px]' : 'text-xs max-w-sm'}`}>
        <span>全く勧めない</span>
        <span>非常に勧めたい</span>
      </div>
    </div>
  )
}
