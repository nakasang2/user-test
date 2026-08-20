import { NextRequest, NextResponse, after } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { list } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { createSignedBlobUrl } from '@/lib/blob'
import { reanalyzeFromRecording } from '@/lib/reanalyze-recording'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'
// ユーザビリティテストは録画保存後に自動でWhisper再文字起こし＋AI分析を行う（after()）。
// その分の実行時間を確保する
export const maxDuration = 300

/** GET — 認可済みダッシュボード向けに録画の短命署名付き URL を発行する */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { recordingUrl: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // recordingUrl が無い場合でも、Blob 側には録画が残っていることがある。
    // アップロード完了の通知（onUploadCompleted は Vercel からの Webhook で届く）が
    // 失敗すると、ファイルはあるのに DB だけ空という状態になり、調査者からは
    // 「録画されなかった」ようにしか見えない。ここで拾い直す。
    let recordingUrl = session.recordingUrl
    if (!recordingUrl) {
      try {
        const found = await list({ prefix: `recordings/${id}`, limit: 100 })
        // 同じセッションで撮り直した場合に備え、いちばん新しいものを採用する
        const newest = found.blobs
          .slice()
          .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0]
        if (newest) {
          recordingUrl = newest.url
          await prisma.session.update({ where: { id }, data: { recordingUrl } })
          console.info(`[UserVoice] 録画を復旧しました（通知の取りこぼし）: session=${id}`)
        }
      } catch (e) {
        console.error('録画の復旧に失敗しました:', e)
      }
    }
    if (!recordingUrl) return NextResponse.json({ error: 'No recording' }, { status: 404 })
    const url = await createSignedBlobUrl(recordingUrl)
    return NextResponse.json({ url })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * 渡された URL が「このセッションの録画として保存された Blob」かどうかを確かめる。
 *
 * PUT は被験者トークンで呼べる（通常 recordingUrl の書き込みはダッシュボード認証を
 * 要求している）。そのため、ここが唯一の歯止めになる。ホスト名を見ないと外部URLを
 * 書き込めてしまい、実際にアップロードされた顔・音声入りの Blob が削除経路
 * （セッション削除・被験者からの削除請求）から永久に漏れる。
 */
function isOwnRecordingUrl(url: string, sessionId: string): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // このプロジェクトの Blob ストアのホストに限定する
  if (!parsed.hostname.endsWith('.blob.vercel-storage.com')) return false
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  const prefix = `recordings/${sessionId}`
  if (!pathname.startsWith(prefix)) return false
  // 別セッションの取り違えを防ぐ。addRandomSuffix / -manual が付くため、
  // 直後は区切り文字（- . /）か終端でなければならない
  const rest = pathname.slice(prefix.length)
  return rest === '' || /^[-./]/.test(rest)
}

/**
 * PUT — アップロードした録画の URL を、被験者本人が確定させる。
 *
 * 従来は `onUploadCompleted`（Vercel からの Webhook）だけに頼っていたため、
 * その通知が届かないとファイルはあるのに DB は空、という状態になり、
 * しかも誰にも気づかれなかった（PoC で一部のセッションの録画が失われた）。
 * クライアントは `upload()` の戻り値で URL を知っているので、こちらからも
 * 確定させる。どちらが先に成功しても同じ結果になる（冪等）。
 */
export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    if (!(await rateLimit(`recording-put:${id}:${getClientIp(request)}`, 20, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body = (await request.json()) as { url?: string; participantToken?: string }
    await requireParticipantToken(id, body.participantToken ?? null)

    const url = typeof body.url === 'string' ? body.url : ''
    if (!isOwnRecordingUrl(url, id)) {
      return NextResponse.json({ error: 'invalid url' }, { status: 400 })
    }

    const updated = await prisma.session.update({
      where: { id },
      data: { recordingUrl: url },
      select: { recordingUrl: true, interview: { select: { type: true } } },
    })
    // 録画からの再文字起こし（ユーザビリティ）はここでは走らせない。
    // onUploadCompleted 側と二重に実行してしまうため。Webhook が届かなかった
    // 場合は、調査者がセッション詳細の「文字起こしをやり直す」から実行できる。
    return NextResponse.json({ ok: true, recordingUrl: updated.recordingUrl })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * POST — Vercel Blob クライアント直アップロードのトークン発行ハンドラ。
 * ブラウザから直接 Blob ストレージへアップロードさせることで、サーバーレス関数の
 * 4.5MB ボディ制限を回避する。録画は顔・音声を含むため非公開（access:'private'）で保存し、
 * 認可は被験者の participantToken（clientPayload 経由）で行う。
 * 完了後 onUploadCompleted で recordingUrl を永続化する（本番では Vercel の Webhook で発火）。
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    if (!(await rateLimit(`recording:${id}:${getClientIp(request)}`, 20, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body = (await request.json()) as HandleUploadBody

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // clientPayload = participantToken。当該セッションの被験者本人のみアップロードを許可
        await requireParticipantToken(id, clientPayload)
        return {
          allowedContentTypes: ['video/webm'],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024, // 1GB
          tokenPayload: id,
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const sessionId = tokenPayload ?? id
        const updated = await prisma.session.update({
          where: { id: sessionId },
          data: { recordingUrl: blob.url },
          select: { interview: { select: { type: true } } },
        })
        // ユーザビリティテストは、タスク中の思考発話がライブでは音量判定のみで
        // 文字化されない（useSilenceNudge）ため、録画の音声から拾い直さないと
        // 不満やつぶやきが分析対象に入らない。録画保存完了を機に自動で行う。
        // 参加者を待たせないよう after() でレスポンス送信後に実行する。
        if (updated.interview.type === 'usability') {
          after(() => reanalyzeFromRecording(sessionId).catch((err) => {
            console.error('録画からの自動文字起こしに失敗しました:', err)
          }))
        }
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    return handleApiError(err)
  }
}
