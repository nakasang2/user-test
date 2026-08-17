'use client'

import { useState } from 'react'

/**
 * 5段階評価の質問。
 *
 * メイン画面と小窓（service モードの事後質問）の両方から使う。2か所に同じものを
 * 置くと、片方だけ直して選択肢の意味がズレる（集計が壊れる）ため共通化してある。
 *
 * compact は小窓のような幅の狭い場所向け。
 */
export default function RatingQuestion({
  question,
  onSubmit,
  compact = false,
}: {
  question: string
  onSubmit: (v: number) => void
  compact?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const labels = ['全く思わない', 'あまり思わない', '普通', 'そう思う', '非常にそう思う']
  return (
    <div className={`text-center w-full ${compact ? '' : 'max-w-sm'}`}>
      <p className={`text-gray-700 leading-relaxed ${compact ? 'text-xs mb-3' : 'text-sm mb-5'}`}>{question}</p>
      <div className={`flex justify-center ${compact ? 'gap-1.5 mb-2' : 'gap-2.5 mb-3'}`}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            onMouseEnter={() => setHovered(v)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSubmit(v)}
            className={`rounded-md font-semibold transition-all border ${
              compact ? 'w-9 h-9 text-sm' : 'w-11 h-11 text-base'
            } ${
              (hovered ?? 0) >= v
                ? 'bg-gray-900 text-white border-gray-900 scale-110'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className={`text-gray-500 ${compact ? 'text-[10px] h-3.5' : 'text-xs h-4'}`}>
        {hovered ? labels[hovered - 1] : ''}
      </p>
    </div>
  )
}
