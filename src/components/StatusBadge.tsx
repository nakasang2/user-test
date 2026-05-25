const COLORS: Record<string, string> = {
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed:  'bg-blue-50 text-blue-700 border-blue-200',
  processing: 'bg-violet-50 text-violet-700 border-violet-200',
  done:       'bg-gray-100 text-gray-700 border-gray-200',
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
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border flex-shrink-0 ${COLORS[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
