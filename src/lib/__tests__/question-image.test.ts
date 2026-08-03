/**
 * 質問に紐づける画像（印象テスト）の正規化・検証の単体テスト。
 *
 *   npm test
 *
 * 3画面（作成・編集・AI設計）と2つの API で同じ値を扱うため、受理される値が
 * 食い違わないことをここで固める。画像は参加者に見せる素材なので、
 * 「保存できたのに参加者側で出ない」が起きると、そのセッションは撮り直せない。
 */
import {
  normalizeImageMode,
  imageDurationOrDefault,
  toQuestionImagePayload,
  validateQuestionImage,
  DEFAULT_IMAGE_DURATION,
} from '../question-image.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}
       got  ${g}
       want ${w}`) }
}

console.log('\n=== 質問に紐づける画像 ===')

console.log('■ 見せ方の正規化（既定は「ずっと表示」）')
eq('timed はそのまま', normalizeImageMode('timed'), 'timed')
eq('persistent はそのまま', normalizeImageMode('persistent'), 'persistent')
eq('null は persistent', normalizeImageMode(null), 'persistent')
eq('未指定は persistent', normalizeImageMode(undefined), 'persistent')
eq('知らない値も persistent（画像が黙って消えないように）', normalizeImageMode('flash'), 'persistent')

console.log('■ 秒数の丸め（参加者側で 0 秒や負の秒にしない）')
eq('既定値は5', imageDurationOrDefault(null), DEFAULT_IMAGE_DURATION)
eq('未指定も既定値', imageDurationOrDefault(undefined), 5)
eq('通常値はそのまま', imageDurationOrDefault(3), 3)
eq('0 は下限に寄せる', imageDurationOrDefault(0), 1)
eq('負数は下限に寄せる', imageDurationOrDefault(-5), 1)
eq('上限を超えたら 60', imageDurationOrDefault(120), 60)
eq('小数は丸める', imageDurationOrDefault(3.6), 4)
eq('NaN は既定値', imageDurationOrDefault(Number.NaN), 5)

console.log('■ 保存用の整形（使われない値を残さない）')
eq('画像が無ければ全部 null',
  toQuestionImagePayload({ imageUrl: '', imageMode: 'timed', imageDuration: 3 }),
  { imageUrl: null, imageMode: null, imageDuration: null })
eq('画像が未指定でも全部 null',
  toQuestionImagePayload({}),
  { imageUrl: null, imageMode: null, imageDuration: null })
eq('persistent では秒数を持たない',
  toQuestionImagePayload({ imageUrl: 'https://e.com/a.png', imageMode: 'persistent', imageDuration: 9 }),
  { imageUrl: 'https://e.com/a.png', imageMode: 'persistent', imageDuration: null })
eq('timed は秒数を持つ',
  toQuestionImagePayload({ imageUrl: 'https://e.com/a.png', imageMode: 'timed', imageDuration: 3 }),
  { imageUrl: 'https://e.com/a.png', imageMode: 'timed', imageDuration: 3 })
eq('timed で秒数未指定なら既定値',
  toQuestionImagePayload({ imageUrl: 'https://e.com/a.png', imageMode: 'timed' }),
  { imageUrl: 'https://e.com/a.png', imageMode: 'timed', imageDuration: 5 })
eq('URL の前後の空白は落とす',
  toQuestionImagePayload({ imageUrl: '  https://e.com/a.png  ' }).imageUrl,
  'https://e.com/a.png')
eq('空白だけの URL は画像なし扱い',
  toQuestionImagePayload({ imageUrl: '   ' }).imageUrl, null)

console.log('■ 検証')
eq('画像が無ければ問題なし', validateQuestionImage({}, '質問1'), null)
eq('https は通る', validateQuestionImage({ imageUrl: 'https://e.com/a.png' }, '質問1'), null)
eq('http も通る', validateQuestionImage({ imageUrl: 'http://e.com/a.png' }, '質問1'), null)
eq('data: は弾く（img src に流さない）',
  validateQuestionImage({ imageUrl: 'data:image/png;base64,AAAA' }, '質問1') !== null, true)
eq('javascript: は弾く',
  validateQuestionImage({ imageUrl: 'javascript:alert(1)' }, '質問1') !== null, true)
eq('相対パスは弾く', validateQuestionImage({ imageUrl: '/a.png' }, '質問1') !== null, true)
eq('エラー文言に質問名を含める',
  validateQuestionImage({ imageUrl: 'ftp://e.com/a.png' }, '質問3')?.includes('質問3'), true)
eq('timed の秒数が範囲外なら弾く',
  validateQuestionImage({ imageUrl: 'https://e.com/a.png', imageMode: 'timed', imageDuration: 90 }, '質問1') !== null, true)
eq('timed の小数は弾く',
  validateQuestionImage({ imageUrl: 'https://e.com/a.png', imageMode: 'timed', imageDuration: 2.5 }, '質問1') !== null, true)
eq('persistent なら秒数が変でも通る（使われないため）',
  validateQuestionImage({ imageUrl: 'https://e.com/a.png', imageMode: 'persistent', imageDuration: 999 }, '質問1'), null)

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
