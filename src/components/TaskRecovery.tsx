'use client'

import { useState } from 'react'
import { ArrowRight, ListChecks } from 'lucide-react'

/**
 * 前提タスクを断念した参加者を、次のタスクの開始地点まで連れて行く画面。
 *
 * タスクが地続きの調査（1「お気に入りに追加」→ 2「お気に入りから購入」）では、
 * 1 で詰まった参加者は 2 を物理的に始められない。そのまま次へ進めると、
 * 2 の結果は「難しかった」ではなく「前提が無かった」を測ってしまう。
 *
 * ユーザビリティテストでは本来モデレーターが口頭で操作を教えて開始地点まで
 * 案内する（アシスト）。ここではその役をリサーチャーが事前に書いた手順
 * （Task.hint）に担わせる。全員に同じ文言を出すので、受ける助けが人によって
 * 変わらない＝参加者間の比較可能性が保たれる。
 *
 * 断念したタスク自体の結果は「断念」のまま記録する（助けたから成功にはしない）。
 * 次のタスクには「前提を代行して開始した」印を付け、自力で到達した人と
 * 混ぜずに集計できるようにする。
 */
export default function TaskRecovery({
  hint,
  nextTaskText,
  compact = false,
  children,
}: {
  /** リサーチャーが書いた立て直し手順（ヒント欄）。無ければ案内のみ */
  hint: string | null
  /** 次に進むタスクの文言。何のための準備か分かるように出す */
  nextTaskText?: string | null
  /** 小窓など幅の狭い場所向け */
  compact?: boolean
  /**
   * 操作ボタン（TaskRecoveryActions）。
   * 小窓は縦が狭く、手順が長いと下の操作が窓の外へ押し出されてしまうため、
   * 説明と操作を別の場所に置けるよう分けている。同じ場所に出す場合はここに入れる。
   */
  children?: React.ReactNode
}) {
  const body = compact ? 'text-[11px]' : 'text-xs'
  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg ${compact ? 'p-2.5' : 'p-3'} space-y-2`}>
      <p className={`flex items-start gap-1.5 text-amber-900 font-semibold leading-snug ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <ListChecks className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 mt-px`} strokeWidth={2} />
        次のタスクに進む準備をお願いします
      </p>
      <p className={`text-amber-900/80 leading-relaxed ${body}`}>
        次のタスクは、いまのタスクができている状態から始まります。
        下の手順のとおりに操作して、準備ができたら次へ進んでください。
        <span className="block mt-0.5 text-amber-800/70">
          うまくいかなかったこと自体は記録済みです。そのままで問題ありません。
        </span>
      </p>

      {hint ? (
        <div className={`bg-white border border-amber-200 rounded-md ${compact ? 'p-2' : 'p-2.5'}`}>
          <p className={`text-amber-700 font-medium mb-1 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>操作の手順</p>
          <p className={`text-gray-900 leading-relaxed whitespace-pre-line ${body}`}>{hint}</p>
        </div>
      ) : (
        /* 手順が未設定のケース。参加者には手がかりが無いので、
           無理に粘らせず「この状態にできない」で先へ進める案内に寄せる */
        <p className={`text-amber-900/80 leading-relaxed ${body}`}>
          手順が用意されていません。ご自身で進められない場合は「この状態にできない」を押してください。
        </p>
      )}

      {nextTaskText && (
        <p className={`text-amber-900/70 leading-snug ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
          次のタスク: {nextTaskText}
        </p>
      )}

      {children}
    </div>
  )
}

/**
 * 立て直しの操作（次へ / できない）。
 * 説明パネルと同じ場所にも、離れた場所（小窓の最下部）にも置けるよう分離している。
 */
export function TaskRecoveryActions({
  onReady,
  onCannot,
  compact = false,
}: {
  /** 開始地点まで到達できた → 次のタスクへ */
  onReady: () => void
  /** どうしてもその状態にできない → 後続を未実施として記録 */
  onCannot: () => void
  compact?: boolean
}) {
  // 押した直後に両方を止める。押すと画面が切り替わるので、素早い2回目のクリックは
  // 同じ位置に来る次の画面のボタン（「達成して次へ」）に当たってしまう
  const [sent, setSent] = useState(false)
  return (
    <div className="space-y-1.5">
      <button
        onClick={() => { if (sent) return; setSent(true); onReady() }}
        disabled={sent}
        className={`w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 active:bg-black disabled:opacity-60 text-white rounded-lg font-semibold transition-colors ${
          compact ? 'py-2.5 text-[13px]' : 'py-2.5 text-sm'
        }`}
      >
        準備できた（次のタスクへ）
        <ArrowRight className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => { if (sent) return; setSent(true); onCannot() }}
        disabled={sent}
        className={`w-full inline-flex items-center justify-center bg-white border border-amber-300 hover:border-amber-500 disabled:opacity-60 text-amber-900 rounded-lg transition-colors ${
          compact ? 'py-2 text-[11px]' : 'py-2.5 text-sm'
        }`}
      >
        この状態にできない
      </button>
    </div>
  )
}
