/**
 * データ捕捉の結合テスト（手動実行）。
 *
 * 被験者フロー（progress / emotions / process）でデータが確実に永続化されること、
 * および participantToken による認可が効いていることを、実際の HTTP エンドポイント越しに検証する。
 *
 * 前提:
 *   1) PostgreSQL に接続できる DATABASE_URL が設定済み（サーバーと同じ DB）
 *   2) dev サーバーが起動している（既定 http://localhost:3000）
 *      例) BASE_URL=http://localhost:3000 npm run dev
 *   3) `prisma db push` 済みで最新スキーマ（participantToken 等）が反映済み
 *
 * 実行:
 *   node scripts/test-data-capture.mjs
 *   BASE_URL=https://your-preview.vercel.app node scripts/test-data-capture.mjs   // プレビュー環境に対しても可
 *
 * 注: OPENAI_API_KEY が未設定でも動作する（AI 要約は失敗扱いでも文字起こし/感情は保存される）。
 *     テスト用に作成したデータは最後に削除する。
 */
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const prisma = new PrismaClient()

let pass = 0
let fail = 0
function ok(name) { pass++; console.log(`  ✅ ${name}`) }
function ng(name, err) { fail++; console.error(`  ❌ ${name}\n     ${err?.message ?? err}`) }
async function step(name, fn) { try { await fn(); ok(name) } catch (e) { ng(name, e) } }

async function main() {
  console.log(`\nデータ捕捉結合テスト @ ${BASE_URL}\n`)

  // ── セットアップ: 組織・インタビュー・セッション（participantToken 付き）を作成 ──
  const participantToken = randomBytes(24).toString('base64url')
  const org = await prisma.organization.create({ data: { name: `__test_org_${Date.now()}` } })
  const interview = await prisma.interview.create({
    data: {
      organizationId: org.id,
      title: '__test_interview',
      questions: { create: [{ text: 'テスト質問', order: 1, type: 'open' }] },
    },
  })
  const session = await prisma.session.create({
    data: {
      interviewId: interview.id,
      dailyRoomName: `__test_${randomBytes(4).toString('hex')}`,
      dailyRoomUrl: 'http://example.test',
      participantToken,
    },
  })
  const sid = session.id
  const authed = { 'Content-Type': 'application/json', 'x-participant-token': participantToken }

  try {
    // ── 1. 認可: トークン無しの progress は 401 ──
    await step('progress: トークン無しは 401 で拒否', async () => {
      const res = await fetch(`${BASE_URL}/api/sessions/${sid}/progress`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: 'x', segments: [] }),
      })
      assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`)
    })

    // ── 2. progress: 逐次保存で文字起こし＋セグメントが残る（AI 分析なし）──
    await step('progress: 文字起こしとセグメントが保存される', async () => {
      const res = await fetch(`${BASE_URL}/api/sessions/${sid}/progress`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({
          transcript: '[Interviewer]: テスト質問\n[Participant]: 途中回答',
          segments: [
            { speaker: 'Interviewer', text: 'テスト質問', start: 0, end: 2 },
            { speaker: 'Participant', text: '途中回答', start: 2, end: 5 },
          ],
        }),
      })
      assert.strictEqual(res.status, 200, `status ${res.status}`)
      const t = await prisma.transcript.findUnique({ where: { sessionId: sid }, include: { segments: true } })
      assert.ok(t, 'transcript not created')
      assert.strictEqual(t.segments.length, 2, `segments=${t.segments.length}`)
      assert.strictEqual(t.summary, null, 'progress は要約を付けない想定')
    })

    // ── 3. emotions: 逐次保存で感情行が作られる ──
    await step('emotions: 感情スナップショットが保存される', async () => {
      const res = await fetch(`${BASE_URL}/api/emotions`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ sessionId: sid, timestamp: 5, happy: 0.8, neutral: 0.2 }),
      })
      assert.strictEqual(res.status, 201, `status ${res.status}`)
      const count = await prisma.emotionResult.count({ where: { sessionId: sid } })
      assert.ok(count >= 1, `emotion rows=${count}`)
    })

    // ── 4. process: 最終保存で要約・セグメント置換・感情・status=done ──
    await step('process: 最終保存で全データが永続化される', async () => {
      const res = await fetch(`${BASE_URL}/api/sessions/${sid}/process`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({
          transcript: '[Interviewer]: テスト質問\n[Participant]: 最終回答です',
          segments: [
            { speaker: 'Interviewer', text: 'テスト質問', start: 0, end: 2 },
            { speaker: 'Participant', text: '最終回答です', start: 2, end: 6 },
          ],
          emotions: [
            { timestamp: 1, happy: 0.5, neutral: 0.5 },
            { timestamp: 6, happy: 0.3, neutral: 0.7 },
          ],
        }),
      })
      assert.strictEqual(res.status, 200, `status ${res.status}`)
      const updated = await prisma.session.findUnique({
        where: { id: sid },
        include: { transcript: { include: { segments: true } }, emotions: true },
      })
      assert.strictEqual(updated.status, 'done', `status=${updated.status}`)
      assert.ok(updated.transcript?.fullText.includes('最終回答'), 'fullText 未更新')
      assert.ok(updated.transcript?.summary, 'summary 未設定（失敗メッセージでも可）')
      assert.strictEqual(updated.transcript.segments.length, 2, `最終セグメント=${updated.transcript.segments.length}`)
      assert.strictEqual(updated.emotions.length, 2, `最終感情=${updated.emotions.length}（process が全置換）`)
    })

    // ── 5. 認可: 別セッションのトークンでは process できない（IDOR 防止）──
    await step('process: 不正トークンは 401', async () => {
      const res = await fetch(`${BASE_URL}/api/sessions/${sid}/process`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-participant-token': 'wrong' },
        body: JSON.stringify({ transcript: 'x', segments: [] }),
      })
      assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`)
    })
  } finally {
    // ── クリーンアップ（Session は Interview 削除でカスケードしないため先に削除）──
    // Session 削除で Transcript・EmotionResult は onDelete: Cascade により連動削除される。
    await prisma.session.delete({ where: { id: sid } }).catch(() => {})
    await prisma.interview.delete({ where: { id: interview.id } }).catch(() => {})
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n結果: ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('テスト実行エラー:', e)
  await prisma.$disconnect()
  process.exit(1)
})
