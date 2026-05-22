const COLORS: Record<string, string> = {
  pending:    'bg-yellow-500/20 text-yellow-400',
  active:     'bg-green-500/20 text-green-400',
  completed:  'bg-blue-500/20 text-blue-400',
  processing: 'bg-purple-500/20 text-purple-400',
  done:       'bg-indigo-500/20 text-indigo-400',
}

const LABELS: Record<string, string> = {
  pending:    '待機中',
  active:     '進行中',
  completed:  '完了',
  processing: '処理中',
  done:       '分析済み',
}

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${COLORS[status] ?? 'bg-gray-700 text-gray-400'}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
