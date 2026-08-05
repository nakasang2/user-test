const COLORS: Record<string, string> = {
  interview:  'bg-gray-100 text-gray-700 border-gray-200',
  impression: 'bg-purple-50 text-purple-700 border-purple-200',
  usability:  'bg-teal-50 text-teal-700 border-teal-200',
}

const LABELS: Record<string, string> = {
  interview:  'インタビュー',
  impression: '印象テスト',
  usability:  'ユーザビリティ',
}

export default function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border flex-shrink-0 ${COLORS[type] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {LABELS[type] ?? type}
    </span>
  )
}
