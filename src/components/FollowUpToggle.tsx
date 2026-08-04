'use client'

import {
  FOLLOW_UP_DEPTH_DEFAULT,
  FOLLOW_UP_DEPTH_OPTIONS,
  normalizeFollowUpDepth,
} from '@/lib/follow-up'

/**
 * 「この質問で AI が深掘りするか」のチェックボックス。
 *
 * 質問を作る画面が3つある（手動作成モーダル・AI設計ページ・編集モーダル）ので、
 * 文言と挙動が食い違わないよう1か所にまとめる。以前ヒント欄を編集画面にだけ足して
 * 作成側2経路に入れ忘れた失敗があるため、部品化して付け忘れも見つけやすくする。
 *
 * 深掘りは自由回答のときだけ意味を持つ（評価・NPS は元々深掘りしない）ので、
 * 呼び出し側で type === 'open' のときだけ描画すること。
 */
export default function FollowUpToggle({
  checked,
  depth,
  onChange,
  onDepthChange,
  questionNumber,
}: {
  /** 未設定（undefined）は「深掘りする」として扱う。既存調査の挙動を変えないため */
  checked: boolean | undefined
  /** 深さ（最大何回まで追い質問するか）。未設定は既定値 */
  depth: number | undefined
  onChange: (next: boolean) => void
  onDepthChange: (next: number) => void
  /** ラベルの読み上げ用。何番目の質問か */
  questionNumber: number
}) {
  const enabled = checked !== false
  const current = normalizeFollowUpDepth(depth ?? FOLLOW_UP_DEPTH_DEFAULT)
  return (
    <div className="flex-1 min-w-0">
      <label className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-snug cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={`質問 ${questionNumber} で AI が深掘りする`}
          className="mt-0.5"
        />
        <span>
          回答に応じて AI が深掘りする
          <span className="text-gray-400">（事実だけ聞きたい質問は外す）</span>
        </span>
      </label>
      {/* 深さは深掘りが有効なときだけ出す。外しても値は保持されるので、
          もう一度チェックすると前の設定が戻る */}
      {enabled && (
        <div className="flex items-center gap-1.5 mt-1 ml-[18px]">
          <label htmlFor={`fu-depth-${questionNumber}`} className="text-[11px] text-gray-500">
            深さ
          </label>
          <select
            id={`fu-depth-${questionNumber}`}
            value={current}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            className="border border-gray-300 text-[11px] rounded px-1.5 py-0.5 focus:outline-none focus:border-gray-900"
          >
            {FOLLOW_UP_DEPTH_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}回まで</option>
            ))}
          </select>
          <span className="text-[11px] text-gray-400">{DEPTH_HINTS[current] ?? ''}</span>
        </div>
      )}
    </div>
  )
}

/** 深さを選ぶときの目安。数字だけだと何回が妥当か判断できない */
const DEPTH_HINTS: Record<number, string> = {
  1: '一度だけ確認する',
  2: '標準',
  3: 'やや掘り下げる',
  4: '深く掘り下げる（負担が増えます）',
  5: '徹底的に掘り下げる（参加者が疲れます）',
}
