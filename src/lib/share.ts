import { prisma } from './db'

/**
 * 共有トークンからレポート用セッションを取得する。
 *
 * 現在時刻の取得はコンポーネントのレンダー内で行うと純粋性の規則に触れるため、
 * データ取得と期限判定をまとめてここに置く。
 */
export async function getSharedSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { shareToken: token },
    select: {
      status: true,
      createdAt: true,
      shareExpiresAt: true,
      participant: { select: { name: true } },
      interview: {
        select: {
          title: true,
          questions: { orderBy: { order: 'asc' }, select: { id: true, text: true, order: true } },
        },
      },
      transcript: {
        select: {
          fullText: true,
          summary: true,
          themes: true,
          sentiment: true,
          sentimentNote: true,
          segments: {
            orderBy: { startTime: 'asc' },
            select: { id: true, speaker: true, text: true, startTime: true, endTime: true, sentiment: true },
          },
        },
      },
      emotions: { orderBy: { timestamp: 'asc' } },
    },
  })

  if (!session) return { session: null, expired: false }

  const expired = session.shareExpiresAt !== null && session.shareExpiresAt.getTime() < Date.now()
  return { session, expired }
}
