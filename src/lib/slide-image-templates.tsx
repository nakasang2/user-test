import type { SlideSection } from './slide-deck-data'

/**
 * SlideSection を、satori（next/og の ImageResponse）で画像化するための JSX に変換する。
 *
 * satori はブラウザではなく、flexbox のみをサポートする専用レンダラーなので、
 * すべての要素に `display: 'flex'` を明示する（暗黙のブロック表示は無い）。
 * grid の複雑な組み合わせは避け、flexDirection と gap だけで組む
 * （装飾用の背景円だけ position:absolute を使う。satori はDOM順で描画するため、
 * 装飾要素を子要素より先に置けば重なりは自然にコンテンツが手前になる）。
 */

export const IMAGE_WIDTH = 1920
export const IMAGE_HEIGHT = 1080

const COLOR = {
  page: '#f4f6f9',
  ink: '#161a20',
  sub: '#5b6472',
  muted: '#8a93a1',
  border: '#e3e6ea',
  cardBg: '#ffffff',
  track: '#eceff3',
  neutralAccent: '#334155',
  facts: '#2563eb',
  hypothesis: '#ea580c',
  hypothesisSoft: '#fff1e6',
  action: '#16a34a',
  coverFrom: '#0b1220',
  coverTo: '#1e3a8a',
} as const

const CARD_SHADOW = '0 10px 30px rgba(15, 23, 42, 0.08)'

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function accentFor(section: SlideSection): string {
  if (section.kind === 'summary') {
    if (section.heading === '事実') return COLOR.facts
    if (section.heading === '仮説') return COLOR.hypothesis
    if (section.heading === '次のアクション') return COLOR.action
  }
  return COLOR.neutralAccent
}

function titleFor(section: SlideSection): string {
  switch (section.kind) {
    case 'cover': return section.title
    case 'kpi': return '全体像'
    case 'intro': return '目的・概要'
    case 'stimulus': return 'テスト対象'
    case 'summary': return section.heading
    case 'task-success': return 'タスク成功率'
    case 'task-detail': return 'タスク別詳細'
    case 'score': return '満足度スコア'
    case 'score-distribution': return section.questionText
    case 'emotion': return '感情・所感の傾向'
    case 'participants': return '参加者別結果'
    case 'highlights': return '注目発言'
  }
}

/** タイトルの上に添える短い分類ラベル（デッキ全体に一貫した文脈を持たせる） */
function kickerFor(section: SlideSection): string {
  switch (section.kind) {
    case 'cover': return '調査結果レポート'
    case 'kpi': return '調査結果レポート'
    case 'intro': return '調査概要'
    case 'stimulus': return '調査概要'
    case 'summary': return `総括 ・ ${section.heading}`
    case 'task-success':
    case 'task-detail':
      return 'タスク計測'
    case 'score':
    case 'score-distribution':
      return '定量データ'
    case 'emotion': return '定量データ'
    case 'participants': return '定量データ'
    case 'highlights': return '定性データ'
  }
}

/** 右上に添える控えめな装飾円。ページ全体の余白に質感を持たせる */
function BackgroundBlob({ color }: { color: string }) {
  return (
    <div style={{
      position: 'absolute', top: -220, right: -220, width: 620, height: 620,
      borderRadius: 999, backgroundColor: hexToRgba(color, 0.06), display: 'flex',
    }} />
  )
}

function Kicker({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      display: 'flex', alignSelf: 'flex-start', alignItems: 'center', gap: 10,
      backgroundColor: hexToRgba(color, 0.12), borderRadius: 999, padding: '10px 22px',
    }}>
      <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: color, display: 'flex' }} />
      <div style={{ fontSize: 22, fontWeight: 700, color, display: 'flex' }}>{label}</div>
    </div>
  )
}

function PageFooter({ index, total, dark }: { index: number; total: number; dark?: boolean }) {
  const color = dark ? 'rgba(255,255,255,0.55)' : COLOR.muted
  const line = dark ? 'rgba(255,255,255,0.16)' : COLOR.border
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <div style={{ height: 1, width: '100%', backgroundColor: line, display: 'flex' }} />
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', padding: '20px 96px 0' }}>
        <div style={{ fontSize: 20, color, display: 'flex' }}>User Interview Report</div>
        <div style={{ fontSize: 20, color, display: 'flex' }}>{index} / {total}</div>
      </div>
    </div>
  )
}

/** 全スライド共通の外枠。分類ラベル＋タイトル、装飾円、下部にページフッター */
function Frame({
  accent, title, kicker, index, total, children,
}: {
  accent: string; title?: string; kicker: string; index: number; total: number; children: React.ReactNode
}) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: COLOR.page, fontFamily: 'Noto Sans JP', position: 'relative', overflow: 'hidden',
    }}>
      <BackgroundBlob color={accent} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '64px 96px 0', gap: 28 }}>
        <Kicker label={kicker} color={accent} />
        {title && (
          <div style={{ fontSize: 48, fontWeight: 700, color: COLOR.ink, display: 'flex' }}>{title}</div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 8 }}>{children}</div>
      </div>
      <PageFooter index={index} total={total} />
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', backgroundColor: COLOR.cardBg,
      borderRadius: 20, padding: '28px 36px', border: `1px solid ${COLOR.border}`,
      boxShadow: CARD_SHADOW, ...style,
    }}>
      {children}
    </div>
  )
}

/**
 * AIが根拠付きで長めの文章を返すようになった分、項目数が多い（4件以上）ときは
 * 固定サイズの1080pxキャンバスからはみ出しうる。件数に応じて段階的に詰めて
 * 収まりを優先する（真の自動収縮ではないが、事前に決め打ちした3段階で十分安全に運用できる）。
 */
function BulletList({ items, accent }: { items: string[]; accent: string }) {
  const dense = items.length >= 6 ? 'tight' : items.length >= 4 ? 'compact' : 'normal'
  const sizing = {
    normal: { gap: 18, padding: '26px 34px', fontSize: 29, lineHeight: 1.55 },
    compact: { gap: 14, padding: '20px 30px', fontSize: 25, lineHeight: 1.5 },
    tight: { gap: 10, padding: '16px 26px', fontSize: 22, lineHeight: 1.45 },
  }[dense]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sizing.gap }}>
      {items.map((text, i) => (
        <div key={i} style={{
          display: 'flex', flexDirection: 'row', backgroundColor: COLOR.cardBg,
          borderRadius: 16, padding: sizing.padding,
          borderTop: `1px solid ${COLOR.border}`, borderRight: `1px solid ${COLOR.border}`,
          borderBottom: `1px solid ${COLOR.border}`, borderLeft: `6px solid ${accent}`,
          boxShadow: CARD_SHADOW,
        }}>
          <div style={{ fontSize: sizing.fontSize, color: COLOR.ink, lineHeight: sizing.lineHeight, display: 'flex' }}>{text}</div>
        </div>
      ))}
    </div>
  )
}

function BarChart({ items, accent }: { items: { label: string; percent: number; displayValue: string }[]; accent: string }) {
  const shown = items.filter((item) => item.displayValue)
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 24,
      backgroundColor: COLOR.cardBg, borderRadius: 20, border: `1px solid ${COLOR.border}`,
      boxShadow: CARD_SHADOW, padding: '40px 44px',
    }}>
      {shown.map((item, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, width: 300 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: accent, display: 'flex' }} />
            <div style={{ fontSize: 26, color: COLOR.ink, display: 'flex' }}>{item.label}</div>
          </div>
          <div style={{ flex: 1, height: 34, backgroundColor: COLOR.track, borderRadius: 17, display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: `${Math.max(2, Math.min(100, item.percent))}%`, height: 34, borderRadius: 17,
              backgroundColor: accent, display: 'flex',
            }} />
          </div>
          <div style={{
            display: 'flex', fontSize: 24, fontWeight: 700, color: accent,
            backgroundColor: hexToRgba(accent, 0.1), borderRadius: 12, padding: '8px 18px',
            minWidth: 220, justifyContent: 'flex-end',
          }}>
            {item.displayValue}
          </div>
        </div>
      ))}
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 20, padding: '28px 48px',
    }}>
      <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 700, color: '#ffffff', display: 'flex' }}>{value}</div>
    </div>
  )
}

/** KPIダッシュボード用の指標カード。白背景ページ上に置くので StatPill とは別の配色にする */
function MetricCard({ label, value, accent, width }: { label: string; value: string; accent: string; width: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12, width,
      backgroundColor: COLOR.cardBg, borderRadius: 20, border: `1px solid ${COLOR.border}`,
      boxShadow: CARD_SHADOW, padding: '32px 36px',
    }}>
      <div style={{ fontSize: 24, color: COLOR.sub, display: 'flex' }}>{label}</div>
      <div style={{ fontSize: 42, fontWeight: 700, color: accent, display: 'flex' }}>{value}</div>
    </div>
  )
}

export function renderSection(section: SlideSection, index: number, total: number): React.ReactElement {
  const accent = accentFor(section)
  const title = titleFor(section)
  const kicker = kickerFor(section)

  switch (section.kind) {
    case 'cover':
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          backgroundImage: `linear-gradient(135deg, ${COLOR.coverFrom} 0%, ${COLOR.coverTo} 100%)`,
          fontFamily: 'Noto Sans JP', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: -240, right: -160, width: 700, height: 700,
            borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex',
          }} />
          <div style={{
            position: 'absolute', bottom: -260, left: -180, width: 560, height: 560,
            borderRadius: 999, backgroundColor: 'rgba(37,99,235,0.18)', display: 'flex',
          }} />
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 44, padding: '0 140px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '10px 24px',
            }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#60a5fa', display: 'flex' }} />
              <div style={{ fontSize: 22, letterSpacing: 2, color: 'rgba(255,255,255,0.75)', display: 'flex' }}>調査結果レポート</div>
            </div>
            <div style={{ fontSize: 66, fontWeight: 700, color: '#ffffff', textAlign: 'center', lineHeight: 1.3, display: 'flex' }}>{section.title}</div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 28, marginTop: 12 }}>
              <StatPill label="実施期間" value={section.period} />
              <StatPill label="参加者数" value={`${section.participantCount}人`} />
            </div>
          </div>
          <PageFooter index={index} total={total} dark />
        </div>
      )

    case 'kpi': {
      const palette = [COLOR.facts, COLOR.action, COLOR.hypothesis, COLOR.neutralAccent]
      // コンテンツ幅1728pxを3列（カード幅560px・gap24px）で並べる。flexの伸縮に任せると
      // 最終行の余りカードだけ幅いっぱいに間延びするため、幅は固定値で揃える
      const cardWidth = 560
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
            {section.items.map((item, i) => (
              <MetricCard key={i} label={item.label} value={item.value} accent={palette[i % palette.length]} width={cardWidth} />
            ))}
          </div>
        </Frame>
      )
    }

    case 'intro':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          {section.objective && (
            <Card>
              <div style={{ fontSize: 22, fontWeight: 700, color: COLOR.sub, marginBottom: 14, display: 'flex' }}>目的</div>
              <div style={{ fontSize: 29, color: COLOR.ink, lineHeight: 1.65, display: 'flex' }}>{section.objective}</div>
            </Card>
          )}
          {section.description && (
            <Card>
              <div style={{ fontSize: 22, fontWeight: 700, color: COLOR.sub, marginBottom: 14, display: 'flex' }}>概要</div>
              <div style={{ fontSize: 29, color: COLOR.ink, lineHeight: 1.65, display: 'flex' }}>{section.description}</div>
            </Card>
          )}
        </Frame>
      )

    case 'stimulus':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            {section.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={section.imageUrl}
                alt={section.caption}
                width={1360}
                height={600}
                style={{ objectFit: 'contain', borderRadius: 20, border: `1px solid ${COLOR.border}`, boxShadow: CARD_SHADOW }}
              />
            )}
            <div style={{
              fontSize: 25, color: COLOR.sub, backgroundColor: COLOR.cardBg, border: `1px solid ${COLOR.border}`,
              borderRadius: 999, padding: '14px 32px', display: 'flex',
            }}>
              {section.caption}
            </div>
          </div>
        </Frame>
      )

    case 'summary':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <BulletList items={section.items} accent={accent} />
        </Frame>
      )

    case 'task-success': {
      const items = [
        { label: '全体成功率', percent: section.rate, displayValue: `${section.rate}%（${section.completed}/${section.total}回）` },
        { label: '自力成功率', percent: section.unaidedRate, displayValue: `${section.unaidedRate}%` },
      ]
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <BarChart items={items} accent={COLOR.facts} />
          {section.hardest && (
            <div style={{
              display: 'flex', flexDirection: 'row', backgroundColor: COLOR.hypothesisSoft,
              borderRadius: 16, padding: '22px 32px', gap: 14, alignItems: 'center',
            }}>
              <div style={{ fontSize: 24, color: COLOR.hypothesis, fontWeight: 700, display: 'flex' }}>最も苦戦したタスク</div>
              <div style={{ fontSize: 24, color: COLOR.ink, display: 'flex' }}>
                {section.hardest.text}（{section.hardest.rate}%）
              </div>
            </div>
          )}
        </Frame>
      )
    }

    case 'task-detail': {
      const cols = ['タスク', '成功率', '平均所要時間', 'ヒント使用率']
      const widths = [0.44, 0.19, 0.19, 0.18]
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <div style={{
            display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${COLOR.border}`, boxShadow: CARD_SHADOW,
          }}>
            <div style={{ display: 'flex', flexDirection: 'row', backgroundColor: COLOR.neutralAccent }}>
              {cols.map((c, i) => (
                <div key={i} style={{
                  width: `${widths[i] * 100}%`, padding: '20px 24px', fontSize: 22,
                  fontWeight: 700, color: '#ffffff', display: 'flex',
                }}>
                  {c}
                </div>
              ))}
            </div>
            {section.rows.map((r, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'row',
                backgroundColor: i % 2 === 0 ? COLOR.cardBg : COLOR.page,
                borderTop: `1px solid ${COLOR.border}`,
              }}>
                {[r.text, r.rate, r.avgDuration, r.hintRate].map((v, j) => (
                  <div key={j} style={{ width: `${widths[j] * 100}%`, padding: '20px 24px', fontSize: 22, color: COLOR.ink, display: 'flex' }}>
                    {v}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Frame>
      )
    }

    case 'score':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <BarChart items={section.rows.map((r) => ({ label: r.label, percent: r.percent, displayValue: r.value }))} accent={COLOR.facts} />
        </Frame>
      )

    case 'score-distribution':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <BarChart
            items={section.buckets.map((b) => ({ label: b.label, percent: b.percent, displayValue: `${b.count}人（${Math.round(b.percent)}%）` }))}
            accent={COLOR.facts}
          />
        </Frame>
      )

    case 'emotion':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <BarChart items={section.rows.map((r) => ({ label: r.label, percent: r.percent, displayValue: r.value }))} accent={COLOR.hypothesis} />
        </Frame>
      )

    case 'participants': {
      const cols = ['参加者', 'ステータス', 'タスク成功', 'スコア']
      const widths = [0.34, 0.22, 0.22, 0.22]
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <div style={{
            display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${COLOR.border}`, boxShadow: CARD_SHADOW,
          }}>
            <div style={{ display: 'flex', flexDirection: 'row', backgroundColor: COLOR.neutralAccent }}>
              {cols.map((c, i) => (
                <div key={i} style={{
                  width: `${widths[i] * 100}%`, padding: '20px 24px', fontSize: 22,
                  fontWeight: 700, color: '#ffffff', display: 'flex',
                }}>
                  {c}
                </div>
              ))}
            </div>
            {section.rows.map((r, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'row',
                backgroundColor: i % 2 === 0 ? COLOR.cardBg : COLOR.page,
                borderTop: `1px solid ${COLOR.border}`,
              }}>
                {[r.name, r.status, r.taskSummary, r.scoreSummary].map((v, j) => (
                  <div key={j} style={{ width: `${widths[j] * 100}%`, padding: '20px 24px', fontSize: 22, color: COLOR.ink, display: 'flex' }}>
                    {v}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Frame>
      )
    }

    case 'highlights':
      return (
        <Frame accent={accent} title={title} kicker={kicker} index={index} total={total}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {section.quotes.map((q, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'row', backgroundColor: COLOR.cardBg,
                borderRadius: 16, padding: '26px 34px', gap: 20, alignItems: 'flex-start',
                border: `1px solid ${COLOR.border}`, boxShadow: CARD_SHADOW,
              }}>
                <div style={{ fontSize: 44, color: accent, fontWeight: 700, display: 'flex' }}>&ldquo;</div>
                <div style={{ fontSize: 26, color: COLOR.ink, lineHeight: 1.5, display: 'flex', flex: 1 }}>{q}</div>
              </div>
            ))}
          </div>
        </Frame>
      )
  }
}
