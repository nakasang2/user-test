/**
 * 経過秒の計算。
 *
 * コンポーネント内で直接 `Date.now()` を書くと、実際にはイベントハンドラの中でも
 * React の純粋性の規則（レンダー中に不純な関数を呼ばない）に引っかかる。
 * 計算をモジュールスコープに出すことで、規則に触れずに済む。
 * あわせて `(Date.now() - base) / 1000` の重複も1箇所にまとめられる。
 */

/** 基準時刻（ミリ秒）からの経過秒 */
export function elapsedSec(baseMs: number): number {
  return (Date.now() - baseMs) / 1000
}

/** 現在時刻（ミリ秒）。基準時刻のリセット用 */
export function nowMs(): number {
  return Date.now()
}

/** キャッシュ回避用の一意な文字列（同一ミリ秒でも衝突しないよう高精度時刻を混ぜる） */
export function cacheBustToken(): string {
  return `${Date.now()}${Math.round(performance.now())}`
}
