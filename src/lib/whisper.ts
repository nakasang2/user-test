import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface TranscriptSegment {
  speaker: string
  text: string
  start: number
  end: number
}

export async function transcribeAudio(audioPath: string): Promise<{
  fullText: string
  segments: TranscriptSegment[]
}> {
  const audioStream = fs.createReadStream(audioPath)

  const transcription = await openai.audio.transcriptions.create({
    file: audioStream,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })

  const fullText = transcription.text
  const segments: TranscriptSegment[] =
    transcription.segments?.map((seg, i) => ({
      speaker: i % 2 === 0 ? 'Interviewer' : 'Participant',
      text: seg.text,
      start: seg.start,
      end: seg.end,
    })) ?? []

  return { fullText, segments }
}

export async function transcribeFromUrl(audioUrl: string): Promise<{
  fullText: string
  segments: TranscriptSegment[]
}> {
  const response = await fetch(audioUrl)
  const buffer = await response.arrayBuffer()
  const tmpPath = path.join('/tmp', `audio_${Date.now()}.mp4`)
  fs.writeFileSync(tmpPath, Buffer.from(buffer))

  try {
    return await transcribeAudio(tmpPath)
  } finally {
    fs.unlinkSync(tmpPath)
  }
}
