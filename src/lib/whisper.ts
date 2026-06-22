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
