import { toFile } from 'openai'
import { getOpenAI } from './openai'

export interface TranscriptSegment {
  speaker: string
  text: string
  start: number
  end: number
}

// Whisper は話者分離（diarization）に対応しないため、話者は 'Unknown' とする。
// 正確な話者識別が必要な場合は Deepgram 等の diarization 対応サービスを利用すること。
const UNKNOWN_SPEAKER = 'Unknown'

/**
 * Whisper が無音・物音だけの音声に対して作り出す定型句。
 *
 * Whisper は「何か喋っているはず」という前提で推論するため、実質無音を渡すと
 * 学習データに多い決まり文句をそのまま返してくる（幻聴／ハルシネーション）。
 * 実際に、参加者が何も答えていないのに「以上で終わりたいと思います。」が
 * 回答として記録され、次の質問へ勝手に進む事故が起きた。
 *
 * 全文がこれらのいずれかに一致する場合だけ捨てる。部分一致で消すと、
 * 本当にお礼を述べた回答まで削ってしまうため。
 */
const HALLUCINATION_PHRASES = [
  'ご視聴ありがとうございました',
  'ご清聴ありがとうございました',
  'ご視聴いただきありがとうございました',
  '最後までご視聴いただきありがとうございました',
  '以上で終わりたいと思います',
  '以上です',
  'おやすみなさい',
  'チャンネル登録お願いします',
  'チャンネル登録よろしくお願いします',
  'ありがとうございました',
  'よろしくお願いします',
  'お疲れ様でした',
  'バイバイ',
]

/** 句読点・空白・記号を落として比較する（末尾の「。」の有無で漏れないように） */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s、。．，！？!?…・「」『』\-ー~〜]/g, '')
}

function isHallucination(text: string): boolean {
  const normalized = normalizeForCompare(text)
  if (!normalized) return true
  return HALLUCINATION_PHRASES.some((phrase) => normalizeForCompare(phrase) === normalized)
}

/**
 * 面談中の1回の回答（短い音声）を文字起こしする。
 *
 * ブラウザ内蔵の音声認識（Web Speech API）は使える環境が限られる。Brave のように
 * Google の音声サービスを無効化しているブラウザでは必ず network エラーになり、
 * 社内ネットワークで遮断されることもある。参加者のブラウザも回線もこちらでは
 * 選べないため、回答の聞き取りはサーバー側の Whisper に寄せる。
 *
 * 話していないのに文が返る（幻聴）を落とすため、`verbose_json` で
 * セグメントごとの確信度を受け取り、無音らしいものを除いてから返す。
 * 何も残らなければ空文字を返し、呼び出し側は「答えなかった」として扱う。
 */
export async function transcribeAnswerAudio(
  audio: Buffer,
  contentType: string,
): Promise<string> {
  // 拡張子は Whisper 側の判定に使われるため、実際の形式に合わせる
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm'
  const file = await toFile(audio, `answer.${ext}`, { type: contentType })
  const transcription = await getOpenAI().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    // 日本語だと明示すると、短い発話での言語推定の揺れが減る
    language: 'ja',
    // 確信度（no_speech_prob / avg_logprob）が要るので verbose_json を使う
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })

  const segments = transcription.segments ?? []
  // セグメントが取れない場合は素のテキストで判定する（形式差への保険）
  if (segments.length === 0) {
    const raw = (transcription.text ?? '').trim()
    return isHallucination(raw) ? '' : raw
  }

  const kept = segments
    // no_speech_prob が高い＝「ここは喋っていない」と Whisper 自身が判断している。
    // avg_logprob が極端に低いものは、確信の無い当て推量なので落とす
    .filter((seg) => (seg.no_speech_prob ?? 0) < 0.6 && (seg.avg_logprob ?? 0) > -1.0)
    .map((seg) => seg.text.trim())
    .filter(Boolean)

  const text = kept.join(' ').trim()
  return isHallucination(text) ? '' : text
}

/**
 * 録画 URL（署名付き）から Whisper で文字起こしする。
 * verbose_json でセグメント単位のタイムスタンプを取得する。
 */
export async function transcribeFromUrl(audioUrl: string): Promise<{
  fullText: string
  segments: TranscriptSegment[]
}> {
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error(`recording fetch failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const file = await toFile(buffer, 'recording.webm', { type: 'video/webm' })

  const transcription = await getOpenAI().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })

  const fullText = transcription.text
  const segments: TranscriptSegment[] =
    transcription.segments?.map((seg) => ({
      speaker: UNKNOWN_SPEAKER,
      text: seg.text,
      start: seg.start,
      end: seg.end,
    })) ?? []

  return { fullText, segments }
}
