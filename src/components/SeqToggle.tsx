'use client'

/**
 * SEQ（タスク直後の「どれくらい簡単でしたか」1〜7）の ON/OFF。
 *
 * 既定は OFF なので、作成時にこの選択肢を見せないと一生 SEQ が取れない。
 * 作成・編集・AI 設計の3画面で同じ文言を出すために共有する。
 */
export default function SeqToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer bg-gray-50 border border-gray-200 rounded-md p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="text-xs text-gray-700 leading-relaxed">
        <span className="font-medium text-gray-900">各タスクの直後に「どれくらい簡単でしたか」を聞く（SEQ）</span>
        <br />
        1〜7 の7段階。成功率だけでは見えない「できたけれど、つらかった」タスクを拾えます。
      </span>
    </label>
  )
}
