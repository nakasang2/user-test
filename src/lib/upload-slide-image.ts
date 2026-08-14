import { put } from '@vercel/blob'

/**
 * サーバー側で生成したスライド画像（PNG Buffer）を公開Blobストアへ上げ、
 * Google Slides の createImage が参照できる公開URLを返す。
 * 質問画像と同じ公開ストア（PUBLIC_IMAGES_READ_WRITE_TOKEN）を使う
 * （既定の録画用ストアは private 設定で公開Blobを作れないため）。
 */
export async function uploadSlideImage(buffer: Buffer, filename: string): Promise<string> {
  if (!process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN) {
    throw new Error('PUBLIC_IMAGES_READ_WRITE_TOKEN is not set')
  }
  const { url } = await put(filename, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'image/png',
    token: process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN,
  })
  return url
}
