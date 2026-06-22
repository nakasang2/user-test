/**
 * サーバー起動時に1度だけ呼ばれる。必須の環境変数を fail-fast で検証する。
 * （process.env を参照するため nodejs ランタイムでのみ実行）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env')
    validateEnv()
  }
}
