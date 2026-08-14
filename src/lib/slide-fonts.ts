import { readFile } from 'fs/promises'
import path from 'path'

/**
 * スライド画像生成（next/og の ImageResponse は内部で satori を使う）に必要な日本語フォント。
 *
 * satori はデフォルトで日本語グリフを持たないため、フォントを明示的に渡さないと
 * 文字が表示されない（豆腐になる）。satori は WOFF2（brotli圧縮）を解凍できないため、
 * 同じ @fontsource パッケージが提供する非圧縮に近い WOFF ファイルを使う（TTF/OTF/WOFF は対応）。
 *
 * 一度読み込んだら（サーバーレス関数のウォーム状態の間は）使い回す。
 */

const FONT_DIR = path.join(process.cwd(), 'node_modules/@fontsource/noto-sans-jp/files')

type SlideFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }

// Promise自体をキャッシュする（値をキャッシュすると、複数スライドを並行描画したときに
// 読み込み完了前の呼び出しが全部キャッシュ未使用と判定し、同じファイルを何度も読んでしまう）
let cached: Promise<SlideFont[]> | null = null

export function loadSlideFonts(): Promise<SlideFont[]> {
  if (!cached) {
    cached = (async () => {
      const [regular, bold] = await Promise.all([
        readFile(path.join(FONT_DIR, 'noto-sans-jp-japanese-400-normal.woff')),
        readFile(path.join(FONT_DIR, 'noto-sans-jp-japanese-700-normal.woff')),
      ])
      return [
        { name: 'Noto Sans JP', data: toArrayBuffer(regular), weight: 400, style: 'normal' as const },
        { name: 'Noto Sans JP', data: toArrayBuffer(bold), weight: 700, style: 'normal' as const },
      ]
    })()
  }
  return cached
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
