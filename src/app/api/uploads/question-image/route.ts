import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'

/**
 * POST /api/uploads/question-image — 質問に紐づける画像のアップロード用トークンを発行する。
 *
 * ブラウザから Blob ストレージへ直接上げる（サーバーレス関数の 4.5MB ボディ制限を回避）。
 * 録画（/api/sessions/[id]/recording）と同じ仕組みだが、認可と公開範囲が違う。
 *
 * - 認可: リサーチャー（editor 以上）。録画は被験者の participantToken だった
 * - 公開範囲: **公開**。被験者は未ログインのまま `<img>` で読むため、署名付き URL を
 *   発行する経路が無い。従来の stimulusUrl も「公開されている画像のURL」を求めていたので
 *   要求水準は下げていない（むしろ推測できないランダムな URL になるぶん良くなる）。
 *   access は呼び出し側（クライアントの upload()）で指定する
 *
 * 保存先の確定は「調査を保存したとき」なので、ここでは DB に何も書かない。
 * アップロードしたまま保存せずに離脱すると Blob が残るが、画像は小さいので許容する。
 *
 * ストア: 録画用の既定ストア（BLOB_READ_WRITE_TOKEN）は private 設定で作成されており、
 * private ストアでは public な blob を一切作れない（store 単位の固定設定で、
 * 個々のアップロードで上書きできない）。そのため質問画像専用に public な
 * Blob ストアを別途作成し、PUBLIC_IMAGES_READ_WRITE_TOKEN で接続している。
 * 既定の BLOB_READ_WRITE_TOKEN を渡すと「Cannot use public access on a private store」
 * で失敗するので、必ずこちらのトークンを明示する。
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await rateLimit(`question-image:${getClientIp(request)}`, 60, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    if (!process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN) {
      console.error('[question-image upload] PUBLIC_IMAGES_READ_WRITE_TOKEN is not set')
      return NextResponse.json({ error: '画像アップロード用のストレージが設定されていません' }, { status: 500 })
    }
    const body = (await request.json()) as HandleUploadBody

    const json = await handleUpload({
      body,
      request,
      token: process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => {
        // トークン発行のリクエストはブラウザから Cookie 付きで来るのでここで認可できる
        await requireRole('editor')
        return {
          allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          addRandomSuffix: true,
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
        }
      },
      // URL は呼び出し元へ返して調査の保存時に永続化するので、ここでは何もしない
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(json)
  } catch (err) {
    return handleApiError(err)
  }
}
