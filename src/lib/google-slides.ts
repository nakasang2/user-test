import { google, slides_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SlideSection } from './slide-deck-data'

/**
 * SlideSection（何を出すか）を実際の Google Slides API 呼び出しに変換する。
 * レイアウトは使わず、すべて BLANK スライドに自前でテキストボックス/表を置く方式にしている
 * （既定レイアウトのプレースホルダーIDを都度探すより単純で、全スライドの見た目を統一できる）。
 */

const MARGIN = 0.5 // インチ
// 表の行数が多いタスク一覧でスライドが際限なく縦長にならないよう上限を設ける。
// 超えた分は「ほか n件」の1行にまとめる（省略した事実が分かるようにする）
const MAX_TABLE_ROWS = 12

type Rgb = { red: number; green: number; blue: number }

// 事実・仮説・次のアクションは意味を持たせて色分けし、他のスライドは中立色に統一する
// （データ部分まで派手にすると散らかって見えるため、色は「気づき」の3枚だけに使う）
const COLOR = {
  neutralText: { red: 0.125, green: 0.129, blue: 0.141 }, // #202124
  neutralBar: { red: 0.855, green: 0.863, blue: 0.878 },  // #dadce0
  factsText: { red: 0.090, green: 0.306, blue: 0.651 },   // #174ea6
  factsBar: { red: 0.259, green: 0.522, blue: 0.957 },    // #4285f4
  hypothesisText: { red: 0.690, green: 0.376, blue: 0 },  // #b06000
  hypothesisBar: { red: 0.984, green: 0.737, blue: 0.016 }, // #fbbc04
  actionText: { red: 0.051, green: 0.396, blue: 0.176 },  // #0d652d
  actionBar: { red: 0.204, green: 0.659, blue: 0.325 },   // #34a853
} as const

function sectionColors(section: SlideSection): { text: Rgb; bar: Rgb } {
  if (section.kind === 'summary') {
    if (section.heading === '事実') return { text: COLOR.factsText, bar: COLOR.factsBar }
    if (section.heading === '仮説') return { text: COLOR.hypothesisText, bar: COLOR.hypothesisBar }
    if (section.heading === '次のアクション') return { text: COLOR.actionText, bar: COLOR.actionBar }
  }
  return { text: COLOR.neutralText, bar: COLOR.neutralBar }
}

interface Renderable {
  title: string
  bullets?: string[]
  paragraph?: string
  table?: { headers: string[]; rows: string[][] }
}

function toRenderable(section: SlideSection): Renderable {
  switch (section.kind) {
    case 'cover':
      return {
        title: section.title,
        paragraph: `実施期間: ${section.period}\n参加者数: ${section.participantCount}人`,
      }
    case 'summary':
      return { title: section.heading, bullets: section.items }
    case 'task-success':
      return {
        title: 'タスク成功率',
        bullets: [
          `全体成功率: ${section.rate}%（${section.completed}/${section.total}回）`,
          `自力成功率: ${section.unaidedRate}%`,
          ...(section.hardest ? [`最も苦戦したタスク: ${section.hardest.text}（${section.hardest.rate}%）`] : []),
        ],
      }
    case 'task-detail': {
      const rows = section.rows.slice(0, MAX_TABLE_ROWS).map((r) => [r.text, r.rate, r.avgDuration, r.hintRate])
      if (section.rows.length > MAX_TABLE_ROWS) {
        rows.push([`ほか ${section.rows.length - MAX_TABLE_ROWS}件`, '', '', ''])
      }
      return { title: 'タスク別詳細', table: { headers: ['タスク', '成功率', '平均所要時間', 'ヒント使用率'], rows } }
    }
    case 'score':
      return { title: '満足度スコア', bullets: section.rows.map((r) => `${r.label}: ${r.value}`) }
    case 'emotion':
      return { title: '感情・所感の傾向', bullets: section.rows.map((r) => `${r.label}: ${r.value}`) }
    case 'highlights':
      return { title: '注目発言', bullets: section.quotes }
  }
}

function inch(n: number) {
  return { magnitude: n * 914400, unit: 'EMU' as const }
}

function rgbColor(c: Rgb) {
  return { opaqueColor: { rgbColor: c } }
}

function buildTextBoxRequests(
  objectId: string,
  slideId: string,
  x: number, y: number, w: number, h: number,
  text: string,
  opts: { bold?: boolean; fontSize?: number; color?: Rgb; bullets?: boolean } = {}
): slides_v1.Schema$Request[] {
  const requests: slides_v1.Schema$Request[] = [
    {
      createShape: {
        objectId,
        shapeType: 'TEXT_BOX',
        elementProperties: {
          pageObjectId: slideId,
          size: { width: inch(w), height: inch(h) },
          transform: { scaleX: 1, scaleY: 1, translateX: x * 914400, translateY: y * 914400, unit: 'EMU' },
        },
      },
    },
    { insertText: { objectId, text } },
  ]
  const styleFields = [
    opts.bold ? 'bold' : null,
    opts.fontSize ? 'fontSize' : null,
    opts.color ? 'foregroundColor' : null,
  ].filter(Boolean)
  if (styleFields.length > 0) {
    requests.push({
      updateTextStyle: {
        objectId,
        style: {
          bold: opts.bold,
          fontSize: opts.fontSize ? { magnitude: opts.fontSize, unit: 'PT' } : undefined,
          foregroundColor: opts.color ? rgbColor(opts.color) : undefined,
        },
        textRange: { type: 'ALL' },
        fields: styleFields.join(','),
      },
    })
  }
  if (opts.bullets) {
    requests.push({
      createParagraphBullets: {
        objectId,
        textRange: { type: 'ALL' },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
      },
    })
  }
  return requests
}

/** タイトルの左に添える色付きの短いバー（アクセント） */
function buildAccentBarRequests(objectId: string, slideId: string, x: number, y: number, h: number, color: Rgb): slides_v1.Schema$Request[] {
  const barWidth = 0.08
  return [
    {
      createShape: {
        objectId,
        shapeType: 'RECTANGLE',
        elementProperties: {
          pageObjectId: slideId,
          size: { width: inch(barWidth), height: inch(h) },
          transform: { scaleX: 1, scaleY: 1, translateX: x * 914400, translateY: y * 914400, unit: 'EMU' },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId,
        // outline.propertyState は「NOT_RENDERED にすると枠線なし」と型定義のコメントに
        // 明記されている値なので、こちらは色を推測せずに枠線ごと消す
        fields: 'shapeBackgroundFill.solidFill.color,outline.propertyState',
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: { rgbColor: color } } },
          outline: { propertyState: 'NOT_RENDERED' },
        },
      },
    },
  ]
}

function buildTableRequests(
  objectId: string,
  slideId: string,
  x: number, y: number, w: number, h: number,
  table: { headers: string[]; rows: string[][] },
  headerBg: Rgb
): slides_v1.Schema$Request[] {
  const rowCount = table.rows.length + 1
  const columnCount = table.headers.length
  const requests: slides_v1.Schema$Request[] = [
    {
      createTable: {
        objectId,
        rows: rowCount,
        columns: columnCount,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: inch(w), height: inch(h) },
          transform: { scaleX: 1, scaleY: 1, translateX: x * 914400, translateY: y * 914400, unit: 'EMU' },
        },
      },
    },
    // ヘッダー行全体に背景色を一括で付ける（セルごとに指定するより1リクエストで済む）
    {
      updateTableCellProperties: {
        objectId,
        tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: columnCount },
        tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: headerBg } } } },
        fields: 'tableCellBackgroundFill.solidFill.color',
      },
    },
  ]
  const allRows = [table.headers, ...table.rows]
  allRows.forEach((row, rowIndex) => {
    row.forEach((cellText, columnIndex) => {
      if (!cellText) return
      requests.push({
        insertText: {
          objectId,
          cellLocation: { rowIndex, columnIndex },
          text: cellText,
        },
      })
      if (rowIndex === 0) {
        requests.push({
          updateTextStyle: {
            objectId,
            cellLocation: { rowIndex, columnIndex },
            style: { bold: true },
            textRange: { type: 'ALL' },
            fields: 'bold',
          },
        })
      }
    })
  })
  return requests
}

function buildSlideRequests(
  slideId: string,
  section: SlideSection,
  widthIn: number,
  heightIn: number
): slides_v1.Schema$Request[] {
  const r = toRenderable(section)
  const { text: textColor, bar: barColor } = sectionColors(section)
  const contentX = MARGIN
  const contentW = widthIn - MARGIN * 2
  const titleH = 0.7
  const titleTextX = contentX + 0.22 // アクセントバーの分だけ本文よりインデントする
  const bodyY = MARGIN + titleH + 0.3
  const bodyH = heightIn - bodyY - MARGIN

  const requests = buildAccentBarRequests(`${slideId}_bar`, slideId, contentX, MARGIN, titleH, barColor)
  requests.push(
    ...buildTextBoxRequests(`${slideId}_title`, slideId, titleTextX, MARGIN, contentW - (titleTextX - contentX), titleH, r.title, {
      bold: true,
      fontSize: 22,
      color: textColor,
    })
  )

  if (r.table) {
    requests.push(...buildTableRequests(`${slideId}_table`, slideId, contentX, bodyY, contentW, bodyH, r.table, COLOR.neutralBar))
  } else if (r.bullets) {
    requests.push(
      ...buildTextBoxRequests(`${slideId}_body`, slideId, contentX, bodyY, contentW, bodyH, r.bullets.join('\n'), {
        bullets: true,
      })
    )
  } else if (r.paragraph) {
    requests.push(
      ...buildTextBoxRequests(`${slideId}_body`, slideId, contentX, bodyY, contentW, bodyH, r.paragraph)
    )
  }

  return requests
}

export async function createSlideDeck(auth: OAuth2Client, title: string, sections: SlideSection[]) {
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
  const widthIn = pageSize.width.magnitude / 914400
  const heightIn = pageSize.height.magnitude / 914400

  const requests: slides_v1.Schema$Request[] = []
  sections.forEach((section, i) => {
    const slideId = `slide_${i}`
    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: 'BLANK' },
      },
    })
    requests.push(...buildSlideRequests(slideId, section, widthIn, heightIn))
  })
  // 生成時に自動で付く既定スライドは、新しいスライドを全部足した後に消す
  // （プレゼンテーションは常に1枚以上必要なため、削除は追加より後でなければならない）
  requests.push({ deleteObject: { objectId: initialSlideId } })

  await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } })

  return { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` }
}
