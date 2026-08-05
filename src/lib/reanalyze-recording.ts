import { prisma } from '@/lib/db'
import { createSignedBlobUrl } from '@/lib/blob'
import { transcribeFromUrl } from '@/lib/whisper'
import { analyzeTranscript } from '@/lib/ai'

/**
 * 保存済み録画から Whisper で再文字起こしし、AI 分析を実行してトランスクリプトを更新する。
 *
 * 呼び出し元は2つ:
 *   - 手動の「録画から文字起こし」ボタン（/api/sessions/[id]/transcribe、認証済み）
 *   - ユーザビリティテストの録画保存完了時の自動実行（/api/sessions/[id]/recording の
 *     onUploadCompleted）。タスク中の思考発話は、ライブでは音量判定のみで文字化されない
 *     （lib/interview-aggregate.ts ではなく useSilenceNudge の設計）ため、録画の音声から
 *     拾い直さないと分析対象に入らない。
 *
 * 認可・存在確認は呼び出し側で済ませてから呼ぶこと（ここでは行わない）。
 * 録画が無いセッションは何もしない（呼び出し側の判断ミスで落ちないように）。
 */
export async function reanalyzeFromRecording(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { interview: { include: { questions: true } } },
  })
  if (!session || !session.recordingUrl) return

  // 非公開録画の署名付き URL を発行し、Whisper で文字起こし
  const signedUrl = await createSignedBlobUrl(session.recordingUrl, 10 * 60 * 1000)
  const { fullText, segments } = await transcribeFromUrl(signedUrl)

  // 時刻付きトランスクリプトで AI 分析
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const timestamped = segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n') || fullText
  const questions = session.interview.questions.map((q) => q.text)
  let summary = ''
  let themes = ''
  try {
    const result = await analyzeTranscript(timestamped, questions)
    summary = result.summary
    themes = result.themes
  } catch (err) {
    console.error('analyzeTranscript failed:', err)
    summary = '分析に失敗しました。'
  }

  const transcript = await prisma.transcript.upsert({
    where: { sessionId },
    // 全体トーンは発言単位の判定と一緒に /process が算出する。
    // 再文字起こしでは中身が変わるため、古い判定を残さず必ずクリアする。
    create: { sessionId, fullText, summary, themes, sentiment: null, sentimentNote: null },
    update: { fullText, summary, themes, sentiment: null, sentimentNote: null },
  })

  // System セグメント（タスク達成記録など）は音声として発話されていないため、
  // Whisper の結果では復元できない。置き換えの前に退避して書き戻す。
  // ※定量データ自体は TaskResult / Answer テーブルにあるので消えないが、
  //   文字起こし上の時系列コンテキストも失わないようにする。
  const preserved = await prisma.transcriptSegment.findMany({
    where: { transcriptId: transcript.id, speaker: 'System' },
    select: { speaker: true, text: true, startTime: true, endTime: true, sentiment: true },
  })

  const merged = [
    ...segments.map((seg) => ({
      transcriptId: transcript.id,
      speaker: seg.speaker,
      text: seg.text,
      startTime: seg.start,
      endTime: seg.end,
      sentiment: null as string | null,
    })),
    ...preserved.map((p) => ({ ...p, transcriptId: transcript.id })),
  ].sort((a, b) => a.startTime - b.startTime)

  // 既存セグメントを Whisper の結果（+ 退避した System 行）で原子的に置き換える
  await prisma.$transaction([
    prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
    prisma.transcriptSegment.createMany({ data: merged }),
  ])

  // process と挙動を揃える: 分析済みにし、比較インサイトのキャッシュを無効化
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'done' } })
  await prisma.interview.update({
    where: { id: session.interview.id },
    data: { commonInsights: null, insightsCount: null },
  }).catch(() => {})
}
