import { NextRequest, NextResponse } from 'next/server'
import { extractStrictChoice } from '@/lib/ai'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

/**
 * POST /api/extract-answer-value
 *
 * 会話の中で自然に答えてもらった rating/nps 質問の発言（自由な言い回し）から、
 * 厳密な数値（例: 1〜5, 0〜10）を抽出する。/api/interviewer と同じく、
 * DB には触れない純粋な AI 判断のみのため未認証（参加者は participantToken しか
 * 持たない）。IP 単位でレート制限し、gpt-4o 課金の枯渇/DoS を防ぐ。
 * 抽出した値の保存は呼び出し側が /api/sessions/[id]/results で行う。
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`extract-answer-value:${getClientIp(req)}`, 30, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const body = await req.json().catch(() => null)
  const questionText = typeof body?.questionText === 'string' ? body.questionText : ''
  const answerText = typeof body?.answerText === 'string' ? body.answerText : ''
  const type = body?.type === 'nps' ? 'nps' : body?.type === 'rating' ? 'rating' : null

  if (!questionText || !answerText || !type) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  try {
    const value = await extractStrictChoice(questionText, answerText, type)
    return NextResponse.json({ value })
  } catch {
    // 抽出失敗は「値なし」と同じ扱いでよい（呼び出し側は文字起こしの引用を残すため実害がない）
    return NextResponse.json({ value: null })
  }
}
