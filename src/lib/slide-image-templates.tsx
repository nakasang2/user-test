import type { SlideSection } from './slide-deck-data'

/**
 * SlideSection を、satori（next/og の ImageResponse）で画像化するための JSX に変換する。
 *
 * satori はブラウザではなく、flexbox のみをサポートする専用レンダラーなので、
 * すべての要素に `display: 'flex'` を明示する（暗黙のブロック表示は無い）。
 * grid・position:absolute の複雑な組み合わせは避け、flexDirection と gap だけで組む。
 */

export const IMAGE_WIDTH = 1920
export const IMAGE_HEIGHT = 1080

const COLOR = {
  bg: '#ffffff',
  ink: '#202124',
  sub: '#5f6368',
  border: '#e2e5e9',
  cardBg: '#f6f8fa',
  track: '#e8eaed',
  neutralAccent: '#5f6368',
  facts: '#1a73e8',
  hypothesis: '#e8710a',
  hypothesisSoft: '#fef3e6',
  action: '#1e8e3e',
} as const

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
    case 'intro': return '目的・概要'
    case 'stimulus': return 'テスト対象'
    case 'summary': return section.heading
    case 'task-success': return 'タスク成功率'
    case 'task-detail': return 'タスク別詳細'
    case 'score': return '満足度スコア'
    case 'emotion': return '感情・所感の傾向'
    case 'highlights': return '注目発言'
  }
}

/** 全スライド共通の外枠。上部に色付きのアクセントバー、内側にヘッダーとコンテンツ */
function Frame({ accent, title, children }: { accent: string; title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: COLOR.bg, fontFamily: 'Noto Sans JP',
    }}>
      <div style={{ height: 14, width: '100%', backgroundColor: accent, display: 'flex' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '56px 96px', gap: 32 }}>
        {title && (
          <div style={{ fontSize: 50, fontWeight: 700, color: COLOR.ink, display: 'flex' }}>{title}</div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</div>
      </div>
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', backgroundColor: COLOR.cardBg,
      borderRadius: 20, padding: '28px 36px', ...style,
    }}>
      {children}
    </div>
  )
}

function BulletList({ items, accent }: { items: string[]; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {items.map((text, i) => (
        <div key={i} style={{
          display: 'flex', flexDirection: 'row', backgroundColor: COLOR.cardBg,
          borderRadius: 16, padding: '24px 32px', borderLeft: `8px solid ${accent}`,
        }}>
          <div style={{ fontSize: 30, color: COLOR.ink, lineHeight: 1.5, display: 'flex' }}>{text}</div>
        </div>
      ))}
    </div>
  )
}

function BarChart({ items, accent }: { items: { label: string; percent: number; displayValue: string }[]; accent: string }) {
  const shown = items.filter((item) => item.displayValue)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, justifyContent: 'center', flex: 1 }}>
      {shown.map((item, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 320, fontSize: 28, color: COLOR.ink, display: 'flex' }}>{item.label}</div>
          <div style={{ flex: 1, height: 40, backgroundColor: COLOR.track, borderRadius: 20, display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: `${Math.max(2, Math.min(100, item.percent))}%`, height: 40, borderRadius: 20,
              backgroundColor: accent, display: 'flex',
            }} />
          </div>
          <div style={{ width: 280, fontSize: 26, fontWeight: 700, color: COLOR.ink, display: 'flex' }}>{item.displayValue}</div>
        </div>
      ))}
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 22, color: COLOR.sub, display: 'flex' }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: COLOR.ink, display: 'flex' }}>{value}</div>
    </div>
  )
}

export function renderSection(section: SlideSection): React.ReactElement {
  const accent = accentFor(section)
  const title = titleFor(section)

  switch (section.kind) {
    case 'cover':
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          backgroundColor: COLOR.bg, fontFamily: 'Noto Sans JP',
        }}>
          <div style={{ height: 14, width: '100%', backgroundColor: COLOR.neutralAccent, display: 'flex' }} />
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 48, padding: '0 140px',
          }}>
            <div style={{ fontSize: 24, letterSpacing: 4, color: COLOR.sub, display: 'flex' }}>調査結果レポート</div>
            <div style={{ fontSize: 68, fontWeight: 700, color: COLOR.ink, textAlign: 'center', display: 'flex' }}>{section.title}</div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 80, marginTop: 20 }}>
              <StatPill label="実施期間" value={section.period} />
              <StatPill label="参加者数" value={`${section.participantCount}人`} />
            </div>
          </div>
        </div>
      )

    case 'intro':
      return (
        <Frame accent={accent} title={title}>
          {section.objective && (
            <Card>
              <div style={{ fontSize: 24, color: COLOR.sub, marginBottom: 12, display: 'flex' }}>目的</div>
              <div style={{ fontSize: 30, color: COLOR.ink, lineHeight: 1.6, display: 'flex' }}>{section.objective}</div>
            </Card>
          )}
          {section.description && (
            <Card>
              <div style={{ fontSize: 24, color: COLOR.sub, marginBottom: 12, display: 'flex' }}>概要</div>
              <div style={{ fontSize: 30, color: COLOR.ink, lineHeight: 1.6, display: 'flex' }}>{section.description}</div>
            </Card>
          )}
        </Frame>
      )

    case 'stimulus':
      return (
        <Frame accent={accent} title={title}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            {section.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={section.imageUrl}
                alt={section.caption}
                width={1400}
                height={640}
                style={{ objectFit: 'contain', borderRadius: 20, border: `1px solid ${COLOR.border}` }}
              />
            )}
            <div style={{
              fontSize: 26, color: COLOR.sub, backgroundColor: COLOR.cardBg,
              borderRadius: 999, padding: '14px 32px', display: 'flex',
            }}>
              {section.caption}
            </div>
          </div>
        </Frame>
      )

    case 'summary':
      return (
        <Frame accent={accent} title={title}>
          <BulletList items={section.items} accent={accent} />
        </Frame>
      )

    case 'task-success': {
      const items = [
        { label: '全体成功率', percent: section.rate, displayValue: `${section.rate}%（${section.completed}/${section.total}回）` },
        { label: '自力成功率', percent: section.unaidedRate, displayValue: `${section.unaidedRate}%` },
      ]
      return (
        <Frame accent={accent} title={title}>
          <BarChart items={items} accent={COLOR.facts} />
          {section.hardest && (
            <div style={{
              display: 'flex', flexDirection: 'row', backgroundColor: COLOR.hypothesisSoft,
              borderRadius: 16, padding: '20px 32px', gap: 12, alignItems: 'center',
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
        <Frame accent={accent} title={title}>
          <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', border: `1px solid ${COLOR.border}` }}>
            <div style={{ display: 'flex', flexDirection: 'row', backgroundColor: COLOR.neutralAccent }}>
              {cols.map((c, i) => (
                <div key={i} style={{
                  width: `${widths[i] * 100}%`, padding: '18px 24px', fontSize: 22,
                  fontWeight: 700, color: '#ffffff', display: 'flex',
                }}>
                  {c}
                </div>
              ))}
            </div>
            {section.rows.map((r, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'row',
                backgroundColor: i % 2 === 0 ? COLOR.bg : COLOR.cardBg,
                borderTop: `1px solid ${COLOR.border}`,
              }}>
                {[r.text, r.rate, r.avgDuration, r.hintRate].map((v, j) => (
                  <div key={j} style={{ width: `${widths[j] * 100}%`, padding: '18px 24px', fontSize: 22, color: COLOR.ink, display: 'flex' }}>
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
        <Frame accent={accent} title={title}>
          <BarChart items={section.rows.map((r) => ({ label: r.label, percent: r.percent, displayValue: r.value }))} accent={COLOR.facts} />
        </Frame>
      )

    case 'emotion':
      return (
        <Frame accent={accent} title={title}>
          <BarChart items={section.rows.map((r) => ({ label: r.label, percent: r.percent, displayValue: r.value }))} accent={COLOR.hypothesis} />
        </Frame>
      )

    case 'highlights':
      return (
        <Frame accent={accent} title={title}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {section.quotes.map((q, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'row', backgroundColor: COLOR.cardBg,
                borderRadius: 16, padding: '24px 32px', gap: 20, alignItems: 'flex-start',
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
