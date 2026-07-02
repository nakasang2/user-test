'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

// Feature 5: 5段階評価コンポーネント
// 誤クリックで即確定しないよう「選択 → 確定」の2段階にしている
export function RatingQuestion({ question, onSubmit }: { question: string; onSubmit: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const labels = ['全く思わない', 'あまり思わない', '普通', 'そう思う', '非常にそう思う']
  const active = hovered ?? selected
  return (
    <div className="text-center max-w-sm w-full">
      <p className="text-sm text-gray-700 mb-5 leading-relaxed">{question}</p>
      <div className="flex gap-2.5 justify-center mb-2">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            onMouseEnter={() => setHovered(v)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setSelected(v)}
            className={`w-11 h-11 rounded-md font-semibold text-base transition-all border ${
              (active ?? 0) >= v
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
            } ${selected === v ? 'scale-110 ring-2 ring-gray-900 ring-offset-1' : ''}`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 h-4 mb-4">
        {active ? labels[active - 1] : ''}
      </p>
      <button
        onClick={() => selected && onSubmit(selected)}
        disabled={!selected}
        className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2 rounded-md text-sm font-medium transition-colors"
      >
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        {selected ? `「${selected}」で回答する` : '選択してください'}
      </button>
    </div>
  )
}

// Feature 5: NPS（0〜10）コンポーネント
export function NpsQuestion({ question, onSubmit }: { question: string; onSubmit: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  return (
    <div className="text-center max-w-lg w-full">
      <p className="text-sm text-gray-700 mb-5 leading-relaxed">{question}</p>
      <div className="flex gap-1 justify-center mb-2.5 flex-wrap">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => {
          const color = v <= 6 ? 'border-red-200 text-red-700 hover:bg-red-50'
            : v <= 8 ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
            : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          return (
            <button
              key={v}
              onMouseEnter={() => setHovered(v)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(v)}
              className={`w-9 h-9 rounded-md font-medium text-sm transition-all bg-white border ${color} ${
                hovered === v ? 'scale-110' : ''
              } ${selected === v ? 'scale-110 ring-2 ring-gray-900 ring-offset-1 font-semibold' : ''}`}
            >
              {v}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-500 max-w-sm mx-auto mb-4">
        <span>全く勧めない</span>
        <span>非常に勧めたい</span>
      </div>
      <button
        onClick={() => selected !== null && onSubmit(selected)}
        disabled={selected === null}
        className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2 rounded-md text-sm font-medium transition-colors"
      >
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        {selected !== null ? `「${selected}」で回答する` : '選択してください'}
      </button>
    </div>
  )
}
