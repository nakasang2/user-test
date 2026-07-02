'use client'

import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { EmotionSnapshot } from '@/hooks/useEmotionDetection'

// リアルタイム感情グラフ（折れ線 + 現在値バー）
type ChartPoint = { t: number; happy: number; neutral: number; sad: number; surprised: number }

const EMOTION_BARS = [
  { key: 'happy',     label: '喜び',  color: '#34d399' },
  { key: 'neutral',   label: '中立',  color: '#9ca3af' },
  { key: 'sad',       label: '悲しみ', color: '#60a5fa' },
  { key: 'surprised', label: '驚き',  color: '#fb923c' },
  { key: 'angry',     label: '怒り',  color: '#f87171' },
  { key: 'fearful',   label: '恐怖',  color: '#a78bfa' },
  { key: 'disgusted', label: '嫌悪',  color: '#4ade80' },
] as const

export default function RealtimeEmotionGraph({ history }: { history: EmotionSnapshot[] }) {
  const latest = history[history.length - 1]

  // recharts 用データ（最新 15 点）
  const chartData: ChartPoint[] = history.slice(-15).map((s, i) => ({
    t: i,
    happy:     Math.round(s.happy * 100),
    neutral:   Math.round(s.neutral * 100),
    sad:       Math.round(s.sad * 100),
    surprised: Math.round(s.surprised * 100),
  }))

  return (
    <div>
      {/* 折れ線グラフ（happy / neutral / sad / surprised） */}
      <div className="mb-2">
        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={72}>
            <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} hide />
              <Area type="monotone" dataKey="happy"     stroke="#34d399" fill="#34d39918" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="neutral"   stroke="#9ca3af" fill="#9ca3af18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="sad"       stroke="#60a5fa" fill="#60a5fa18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="surprised" stroke="#fb923c" fill="#fb923c18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[72px] flex items-center justify-center text-[10px] text-gray-700">
            検出待ち...
          </div>
        )}
        {/* 凡例 */}
        <div className="flex gap-3 justify-center mt-1">
          {[
            { label: '喜び',  color: '#10b981' },
            { label: '中立',  color: '#6b7280' },
            { label: '悲しみ', color: '#3b82f6' },
            { label: '驚き',  color: '#f97316' },
          ].map((e) => (
            <span key={e.label} className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="w-2 h-0.5 rounded-full inline-block" style={{ backgroundColor: e.color }} />
              {e.label}
            </span>
          ))}
        </div>
      </div>

      {/* 現在値バー（全7感情） */}
      {latest && (
        <div className="space-y-1 mt-2">
          {EMOTION_BARS.map(({ key, label, color }) => {
            const pct = Math.round((latest[key] as number) * 100)
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 w-7 text-right leading-none">{label}</span>
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-[9px] text-gray-500 w-5 text-right leading-none">{pct}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 感情スナップショットから最も強い感情のラベルを返す
export function getDominantEmotionLabel(e: EmotionSnapshot): string {
  const keys = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'] as const
  const dominant = keys.reduce((a, b) => (e[a] >= e[b] ? a : b))
  const labels: Record<typeof dominant, string> = {
    happy: '喜び',
    sad: '悲しみ',
    angry: '怒り',
    fearful: '恐怖',
    disgusted: '嫌悪',
    surprised: '驚き',
    neutral: '中立',
  }
  return labels[dominant]
}
