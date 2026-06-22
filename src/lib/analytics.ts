/**
 * プロダクト分析イベントのプロバイダ非依存ラッパー。
 *
 * 送信先（PostHog / Vercel Analytics / 自前エンドポイント等）は未選定。
 * 現状は開発時に console 出力するのみで、本番は no-op。
 * ベンダーを選定したら track() 内の送信処理だけ差し替えればよい（呼び出し側は変更不要）。
 *
 * サーバー/クライアントどちらからも呼べる（console は両環境で動作）。
 */

export type AnalyticsEvent =
  // 被験者ファネル（離脱率・品質）
  | 'join_viewed'
  | 'interview_started'
  | 'interview_completed'
  | 'interview_tts_failed'
  | 'interview_speech_fallback'
  | 'interview_process_failed'
  // 主催者ファネル
  | 'interview_created'
  | 'invite_copied'
  | 'recording_transcribed'
  | 'report_shared'

type AnalyticsProps = Record<string, string | number | boolean | null | undefined>

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  try {
    // 計測の有効化は環境変数で切り替える（未選定のため既定は無効）。
    const enabled =
      process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === '1' || process.env.NODE_ENV !== 'production'
    if (!enabled) return

    // TODO: ベンダー選定後にここで送信する。
    //   例) window.posthog?.capture(event, props)
    //   例) import { track as vercelTrack } from '@vercel/analytics'; vercelTrack(event, props)
    if (typeof console !== 'undefined') {
      console.debug('[analytics]', event, props ?? {})
    }
  } catch {
    // 計測の失敗はアプリ本体の動作に影響させない
  }
}
