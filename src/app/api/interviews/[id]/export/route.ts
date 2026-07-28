import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, handleApiError } from '@/lib/api-auth'

/**
 * GET /api/interviews/[id]/export — インタビュー配下の全セッションを1つの CSV にまとめて出力。
 *
 * 従来はセッションを1件ずつ開いて個別 CSV を落とすしかなく、表計算での横断分析ができなかった。
 * 参加者を行方向に並べ、タスク結果・スコア・ハイライトをセクション分けして出す。
 */

/** Excel の数式インジェクション対策 + CSV エスケープ。被験者由来の値は必ずここを通す。 */
const q = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params

    const interview = await prisma.interview.findFirst({
      where: { id, organizationId: orgId },
      select: {
        title: true,
        sessions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            createdAt: true,
            consentedAt: true,
            participant: { select: { name: true } },
            transcript: { select: { summary: true, themes: true, sentiment: true } },
            taskResults: { orderBy: { order: 'asc' } },
            answers: { orderBy: { order: 'asc' } },
            highlights: { orderBy: { startTime: 'asc' } },
          },
        },
      },
    })
    if (!interview) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows: string[][] = []
    const name = (s: { participant: { name: string } | null }) => s.participant?.name ?? 'Anonymous'

    // 1) セッション一覧（1行1参加者）
    rows.push(['# セッション'])
    rows.push(['participant', 'status', 'startedAt', 'consentedAt', 'overallSentiment', 'themes', 'summary'].map(q))
    for (const s of interview.sessions) {
      rows.push([
        q(name(s)), q(s.status), q(fmtDate(s.createdAt)),
        q(s.consentedAt ? fmtDate(s.consentedAt) : ''),
        q(s.transcript?.sentiment ?? ''), q(s.transcript?.themes ?? ''), q(s.transcript?.summary ?? ''),
      ])
    }
    rows.push([])

    // 2) タスク結果（成功率・所要時間の集計用。1行1タスク×参加者）
    rows.push(['# タスク結果'])
    rows.push(['participant', 'taskOrder', 'task', 'outcome', 'durationSec'].map(q))
    for (const s of interview.sessions) {
      for (const t of s.taskResults) {
        rows.push([
          q(name(s)), q(t.order), q(t.text),
          q(t.outcome === 'completed' ? '達成' : 'できなかった'),
          q(t.durationSec != null ? Math.round(t.durationSec) : ''),
        ])
      }
    }
    rows.push([])

    // 3) 回答（スコアと自由回答）
    rows.push(['# 回答'])
    rows.push(['participant', 'questionOrder', 'question', 'type', 'value', 'text'].map(q))
    for (const s of interview.sessions) {
      for (const a of s.answers) {
        rows.push([
          q(name(s)), q(a.order), q(a.text), q(a.type),
          q(a.valueNum ?? ''), q(a.valueText ?? ''),
        ])
      }
    }
    rows.push([])

    // 4) ハイライト（リサーチャーの引用・メモ・タグ）
    rows.push(['# ハイライト'])
    rows.push(['participant', 'startTimeSec', 'quote', 'note', 'tags'].map(q))
    for (const s of interview.sessions) {
      for (const h of s.highlights) {
        rows.push([
          q(name(s)), q(h.startTime != null ? Math.round(h.startTime) : ''),
          q(h.quote), q(h.note ?? ''), q(h.tags.join(' / ')),
        ])
      }
    }

    // Excel が UTF-8 と判定できるよう BOM を付ける
    const csv = '﻿' + rows.map((r) => r.join(',')).join('\r\n')
    const filename = `interview_${id.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
