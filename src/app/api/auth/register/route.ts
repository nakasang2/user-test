import { NextResponse } from 'next/server'

/**
 * POST /api/auth/register — 無効化済み。
 *
 * 社内利用のみのため、新しい組織を誰でも作れる公開登録は廃止した。
 * 新しいメンバーは既存組織のオーナー/管理者からの招待（/invite/[token]）経由でのみ参加できる。
 * 元の実装（新規組織作成込みの登録処理）は git 履歴に残っているため、
 * 将来公開登録を再開する場合はそこから復元する。
 */
export async function POST() {
  return NextResponse.json(
    { error: '新規登録は現在ご利用いただけません。管理者からの招待リンクをご利用ください。' },
    { status: 403 }
  )
}
