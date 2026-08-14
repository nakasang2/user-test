import { ImageResponse } from 'next/og'
import type { ReactElement } from 'react'
import { loadSlideFonts } from './slide-fonts'

/** JSX（satori互換のdiv/imgのみ・inline style・flexboxのみ）をPNG画像のBufferに変換する */
export async function renderSlideImage(
  element: ReactElement,
  width: number,
  height: number
): Promise<Buffer> {
  const fonts = await loadSlideFonts()
  const response = new ImageResponse(element, { width, height, fonts })
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
