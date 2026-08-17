import { NextRequest, NextResponse } from 'next/server'
import { transcribeAnswerAudio } from '@/lib/whisper'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'
// 数十秒の回答音声でも取りこぼさないよう、既定より長めに取る
export const maxDuration = 60

/** 1回の回答として受け付ける音声の上限（約1〜2分の発話を想定） */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024

/**
 * POST /api/transcribe-answer
 * body: 音声そのもの（audio/webm 等）
 * response: { text: string }
 *
 * 面談中に参加者が話した「1回分の回答」を文字起こしする。
 *
 * ブラウザ内蔵の音声認識は使える環境が限られる（Brave は Google の音声サービスを
 * 無効化しているため必ず network エラーになり、社内ネットワークで遮断されることも
 * ある）。参加者のブラウザも回線もこちらでは選べないので、聞き取りはここに寄せる。
 *
 * 参加者が使うため未認証。OpenAI の課金枯渇・DoS を防ぐため IP 単位で制限する。
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`transcribe-answer:${getClientIp(req)}`, 60, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const contentType = req.headers.get('content-type') ?? 'audio/webm'
  const buffer = Buffer.from(await req.arrayBuffer())
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'audio is required' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'audio is too large' }, { status: 413 })
  }

  try {
    const text = await transcribeAnswerAudio(buffer, contentType)
    return NextResponse.json({ text }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    // 面談は止めない。呼び出し側はテキスト入力へ誘導する
    console.error('[UserVoice] 回答の文字起こしに失敗しました:', err)
    return NextResponse.json({ error: 'transcription failed' }, { status: 502 })
  }
}
