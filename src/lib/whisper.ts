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
 * 面談中の1回の回答（短い音声）を文字起こしする。
 *
 * ブラウザ内蔵の音声認識（Web Speech API）は使える環境が限られる。Brave のように
 * Google の音声サービスを無効化しているブラウザでは必ず network エラーになり、
 * 社内ネットワークで遮断されることもある。参加者のブラウザも回線もこちらでは
 * 選べないため、回答の聞き取りはサーバー側の Whisper に寄せる。
 *
 * 会話を止めないよう、タイムスタンプは取らずテキストだけを速く返す。
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
    response_format: 'text',
  })
  // response_format: 'text' の戻りは文字列
  return String(transcription).trim()
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
