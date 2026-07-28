'use client'

import { useRef } from 'react'

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
  Cell,
  ReferenceLine,
} from 'recharts'
import { LineChart as LineChartIcon, Info } from 'lucide-react'

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
  /**
   * 表示する内容を用途で選ぶ。1画面に複数置くとき、同じグラフが重複しないようにするため。
   * - 'timeline': 時系列グラフのみ（動画のシークバーとして上部に固定する用途）
   * - 'summary':  セッションの総括（注記・平均％・最頻表情・平均分布）。時系列は含まない
   * - 'full':     すべて（共有レポートなど、1つしか置かない場所）
   */
  variant?: 'timeline' | 'summary' | 'full'
}

const EMOTION_COLORS = {
  happy: '#10b981',
  neutral: '#6b7280',
  surprised: '#f59e0b',
  sad: '#3b82f6',
  fearful: '#8b5cf6',
  angry: '#ef4444',
  disgusted: '#ec4899',
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

export default function EmotionChart({ emotions, currentTime, onSeek, variant = 'full' }: Props) {
  const showTimeline = variant === 'timeline' || variant === 'full'
  const showSummary = variant === 'summary' || variant === 'full'
  const compact = variant === 'timeline'
  // グラフの描画領域を実測してクリック位置から時刻を求めるため（フック規則上ここで宣言）
  const chartBoxRef = useRef<HTMLDivElement>(null)

  if (emotions.length === 0) {
    return (
      <div className="p-8 text-center bg-white border border-gray-200 rounded-lg">
        <LineChartIcon className="w-5 h-5 text-gray-400 mx-auto mb-3" strokeWidth={1.75} />
        <p className="text-sm text-gray-500">感情データがありません。インタビュー中に収集されます。</p>
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

  /**
   * グラフのクリック位置から、最も近いデータ点の時刻を求めてシークする。
   * 目盛りの実描画領域（recharts のグリッド要素）を基準にするため、
   * 軸ラベルの幅や余白があってもズレない。
   */
  function handleChartClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek || chartData.length === 0) return
    const box = chartBoxRef.current
    if (!box) return
    // グリッド＝実際にデータが描かれている矩形。取れないときはコンテナ全体で代用する
    const grid = box.querySelector('.recharts-cartesian-grid')
    const rect = (grid ?? box).getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const idx = Math.round(ratio * (chartData.length - 1))
    onSeek(chartData[idx].timestamp)
  }

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


  return (
    <div className={compact ? 'space-y-3' : 'space-y-6'}>
      {/* 補助指標であることの注記（表情推定の限界を明示） */}
      {showSummary && (
      <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 leading-relaxed">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400" strokeWidth={2} />
        <span>
          以下は<strong className="text-gray-700 font-medium">カメラ映像の表情から推定したエンゲージメント指標</strong>です。
          実際の感情とは異なる場合があり、照明・角度・個人差の影響を受けます。意思決定の補助的な参考としてご利用ください
          （検出 {emotions.length} 件 / 約5秒間隔・顔未検出時はスキップ）。
        </span>
      </div>
      )}

      {showSummary && (
      <div className="grid grid-cols-4 gap-3">
        {avgEmotions
          .sort((a, b) => b.value - a.value)
          .slice(0, 4)
          .map((e, i) => (
            <div key={e.emotion} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-2xl font-semibold tracking-tight mb-1" style={{ color: e.color }}>
                {e.value}%
              </div>
              <div className="text-sm text-gray-700 flex items-center gap-1.5">
                {e.emotion}
                {/* 最多をここで示す。別カードに切り出すと同じ情報が二重になるため */}
                {i === 0 && <span className="text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1 rounded">最多</span>}
              </div>
            </div>
          ))}
      </div>
      )}


      {showTimeline && (
      <div className={`bg-white border border-gray-200 rounded-lg ${compact ? 'p-4' : 'p-6'}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold tracking-tight text-gray-900">表情推定値の推移（参考・時系列）</h3>
          {onSeek && (
            <span className="text-[10px] text-gray-500">
              クリックでその時刻にジャンプ／再生位置はグラフと会話ログに反映されます
            </span>
          )}
        </div>
        {/* クリック位置から時刻を求める。
            recharts の onClick はホバー状態（activeIndex）に依存し、2系にあった
            activePayload も 3系では渡ってこないため、描画領域の実測値から自前で算出する。 */}
        <div ref={chartBoxRef} onClick={handleChartClick}>
        <ResponsiveContainer width="100%" height={compact ? 210 : 280}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            style={{ cursor: onSeek ? 'pointer' : 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
            <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#111827' }}
              labelStyle={{ color: '#6b7280' }}
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
                stroke="#1f2937"
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{ value: '|', position: 'top', fill: '#1f2937', fontSize: 10 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
      )}

      {showSummary && (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-semibold tracking-tight text-gray-900 mb-4">表情推定値の平均分布（参考）</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={avgEmotions} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
            <YAxis type="category" dataKey="emotion" stroke="#6b7280" tick={{ fontSize: 11 }} width={50} />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#111827' }}
            />
            <Bar dataKey="value" fill="#1f2937" radius={[0, 4, 4, 0]}>
              {avgEmotions.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  )
}
