'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts'

interface EmotionResult {
  timestamp: number
  happy: number
  sad: number
  angry: number
  fearful: number
  disgusted: number
  surprised: number
  neutral: number
}

interface Props {
  emotions: EmotionResult[]
  /** 動画の現在再生位置（秒）。渡すとグラフに現在位置マーカーが表示される */
  currentTime?: number
  /** グラフのある時点をクリックしたときに呼ばれるコールバック */
  onSeek?: (timestamp: number) => void
}

const EMOTION_COLORS = {
  happy: '#34d399',
  neutral: '#94a3b8',
  surprised: '#fb923c',
  sad: '#60a5fa',
  fearful: '#a78bfa',
  angry: '#f87171',
  disgusted: '#4ade80',
}

const EMOTION_LABELS: Record<string, string> = {
  happy: '喜び',
  neutral: '中立',
  surprised: '驚き',
  sad: '悲しみ',
  fearful: '恐怖',
  angry: '怒り',
  disgusted: '嫌悪',
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export default function EmotionChart({ emotions, currentTime, onSeek }: Props) {
  if (emotions.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
        感情データがありません。インタビュー中に収集されます。
      </div>
    )
  }

  // timestamp を保持しておき、クリック時のシークに使う
  const chartData = emotions.map((e) => ({
    timestamp: e.timestamp,
    time: formatTime(e.timestamp),
    ...Object.fromEntries(
      Object.entries(e)
        .filter(([k]) => k !== 'timestamp')
        .map(([k, v]) => [k, Number((v * 100).toFixed(1))])
    ),
  }))

  // 現在の再生位置に最も近いデータ点のラベルを取得
  const currentLabel = currentTime !== undefined && emotions.length > 0
    ? formatTime(
        emotions.reduce((a, b) =>
          Math.abs(a.timestamp - currentTime) < Math.abs(b.timestamp - currentTime) ? a : b
        ).timestamp
      )
    : undefined

  const avgEmotions = Object.keys(EMOTION_COLORS).map((key) => ({
    emotion: EMOTION_LABELS[key],
    value: Number(
      (
        (emotions.reduce((sum, e) => sum + (e[key as keyof EmotionResult] as number), 0) /
          emotions.length) *
        100
      ).toFixed(1)
    ),
    color: EMOTION_COLORS[key as keyof typeof EMOTION_COLORS],
  }))

  const dominant = avgEmotions.reduce((a, b) => (a.value > b.value ? a : b))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {avgEmotions
          .sort((a, b) => b.value - a.value)
          .slice(0, 4)
          .map((e) => (
            <div key={e.emotion} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-2xl font-bold mb-1" style={{ color: e.color }}>
                {e.value}%
              </div>
              <div className="text-sm text-gray-400">{e.emotion}</div>
            </div>
          ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-sm text-gray-400 mb-1">主要感情</div>
        <div className="font-semibold" style={{ color: dominant.color }}>
          {dominant.emotion} ({dominant.value}%)
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300">感情の推移（時系列）</h3>
          {onSeek && (
            <span className="text-[10px] text-gray-600">
              グラフをクリックすると動画がその時刻にジャンプします
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            style={{ cursor: onSeek ? 'pointer' : 'default' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(data: any) => {
              const ts = data?.activePayload?.[0]?.payload?.timestamp
              if (ts !== undefined) onSeek?.(ts)
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
            <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Legend formatter={(val) => EMOTION_LABELS[val] ?? val} />
            {Object.entries(EMOTION_COLORS).map(([key, color]) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
            {/* 現在の再生位置を示す縦線 */}
            {currentLabel && (
              <ReferenceLine
                x={currentLabel}
                stroke="#ffffff90"
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{ value: '▶', position: 'top', fill: '#ffffff90', fontSize: 10 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">感情の平均分布</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={avgEmotions} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
            <YAxis type="category" dataKey="emotion" stroke="#6b7280" tick={{ fontSize: 11 }} width={50} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            />
            <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]}>
              {avgEmotions.map((entry, index) => (
                <rect key={index} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
