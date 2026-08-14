import { google, slides_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

/**
 * スライドの中身はすべて事前にJSXから画像として描画済み（slide-image-templates.tsx +
 * render-slide-image.ts）なので、ここでの役割はその画像を1枚ずつBLANKスライドへ
 * 全面貼り込みするだけになる（デザインの再現度を優先し、Slides上でのテキスト編集は諦める構成）。
 *
 * ただし「仮説で名前を引用した参加者が誰か分かるようにリンクを張る」要件だけは、
 * 画像化すると文中の一部だけにリンクを張れなくなるため実現できない。
 * 代わりに最後に「参加者一覧」を1枚だけ通常のテキストボックスで追加し、
 * 各参加者名からセッション詳細への実リンクを張る（この1枚だけは画像ではない）。
 */
export async function createSlideDeck(
  auth: OAuth2Client,
  title: string,
  imageUrls: string[],
  participantLinks: Record<string, string> = {}
) {
  const slidesApi = google.slides({ version: 'v1', auth })

  const created = await slidesApi.presentations.create({ requestBody: { title } })
  const presentationId = created.data.presentationId
  const pageSize = created.data.pageSize
  const initialSlideId = created.data.slides?.[0]?.objectId
  if (
    !presentationId || !initialSlideId ||
    !pageSize?.width?.magnitude || !pageSize?.height?.magnitude ||
    pageSize.width.unit !== 'EMU' || pageSize.height.unit !== 'EMU'
  ) {
    throw new Error('プレゼンテーションの作成に失敗しました')
  }
  const width = pageSize.width
  const height = pageSize.height
  const widthIn = pageSize.width.magnitude / 914400
  const heightIn = pageSize.height.magnitude / 914400

  const requests: slides_v1.Schema$Request[] = []
  imageUrls.forEach((url, i) => {
    const slideId = `slide_${i}`
    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: 'BLANK' },
      },
    })
    requests.push({
      createImage: {
        objectId: `${slideId}_pic`,
        url,
        elementProperties: {
          pageObjectId: slideId,
          size: { width, height },
          transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' },
        },
      },
    })
  })

  const participantEntries = Object.entries(participantLinks)
  if (participantEntries.length > 0) {
    requests.push(
      ...buildParticipantIndexSlideRequests('slide_participants', imageUrls.length, widthIn, heightIn, participantEntries)
    )
  }

  // 生成時に自動で付く既定スライドは、新しいスライドを全部足した後に消す
  // （プレゼンテーションは常に1枚以上必要なため、削除は追加より後でなければならない）
  requests.push({ deleteObject: { objectId: initialSlideId } })

  await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } })

  return { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` }
}

const MARGIN = 0.5 // インチ

/** 画像スライドの最後に添える、参加者名→セッション詳細への実リンク一覧（この1枚だけ非画像） */
function buildParticipantIndexSlideRequests(
  slideId: string,
  insertionIndex: number,
  widthIn: number,
  heightIn: number,
  entries: [string, string][]
): slides_v1.Schema$Request[] {
  const titleObjectId = `${slideId}_title`
  const listObjectId = `${slideId}_list`
  const contentX = MARGIN
  const contentW = widthIn - MARGIN * 2
  const titleH = 0.7
  const bodyY = MARGIN + titleH + 0.3
  const bodyH = heightIn - bodyY - MARGIN
  const listText = entries.map(([name]) => name).join('\n')

  const requests: slides_v1.Schema$Request[] = [
    {
      createSlide: {
        objectId: slideId,
        insertionIndex,
        slideLayoutReference: { predefinedLayout: 'BLANK' },
      },
    },
    {
      createShape: {
        objectId: titleObjectId,
        shapeType: 'TEXT_BOX',
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: contentW * 914400, unit: 'EMU' }, height: { magnitude: titleH * 914400, unit: 'EMU' } },
          transform: { scaleX: 1, scaleY: 1, translateX: contentX * 914400, translateY: MARGIN * 914400, unit: 'EMU' },
        },
      },
    },
    { insertText: { objectId: titleObjectId, text: '参加者一覧' } },
    {
      updateTextStyle: {
        objectId: titleObjectId,
        style: { bold: true, fontSize: { magnitude: 22, unit: 'PT' } },
        textRange: { type: 'ALL' },
        fields: 'bold,fontSize',
      },
    },
    {
      createShape: {
        objectId: listObjectId,
        shapeType: 'TEXT_BOX',
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: contentW * 914400, unit: 'EMU' }, height: { magnitude: bodyH * 914400, unit: 'EMU' } },
          transform: { scaleX: 1, scaleY: 1, translateX: contentX * 914400, translateY: bodyY * 914400, unit: 'EMU' },
        },
      },
    },
    { insertText: { objectId: listObjectId, text: listText } },
    {
      createParagraphBullets: {
        objectId: listObjectId,
        textRange: { type: 'ALL' },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
      },
    },
  ]

  let cursor = 0
  entries.forEach(([name, url], i) => {
    if (i > 0) cursor += 1 // 直前の行の改行文字ぶん
    requests.push({
      updateTextStyle: {
        objectId: listObjectId,
        style: { link: { url } },
        textRange: { type: 'FIXED_RANGE', startIndex: cursor, endIndex: cursor + name.length },
        fields: 'link',
      },
    })
    cursor += name.length
  })

  return requests
}
