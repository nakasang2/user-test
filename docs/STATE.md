# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-16（リリース可否QA — UX/UI監査58件修正、ブランチ qa/release-readiness）

## 進行中
- リリース可否QA → 出荷ハンドオフ中。ブランチ `qa/release-readiness`（コミット f89d31e）。
  - 多エージェント監査で確定58件を全修正。tsc通過、敵対的リグレッションレビュー0件、ダッシュ/ログイン/登録/トップ/小窓は実機描画OK。
  - **このセッションからは push/merge/本番反映確認が不可**（GitHub認証がsandboxで読めず `git push` 失敗、`next build` はGoogle Fonts遮断で未完、Vercel URLもnetwork非許可）。→ ユーザーのローカル端末で `npx next build` → `git push -u origin qa/release-readiness` → GitHub WebでPR merge を依頼済み。
  - 環境変数（DATABASE_URL 等）は Vercel(user-test) に設定済みとユーザー確認済み。DBスキーマはデプロイ時 `prisma db push` で自動作成。

## 次にやること（再開ポイント）
- ユーザーが push→merge 実行後、preview ブラウザ（network有）で**本番Vercel URLを開いて反映・動作確認**する（ship step4/5）。本番URLが不明なら聞いて DECISIONS に記録。
- 社内テスト前チェックリスト（トップ→登録→テスト作成→招待→被験者実施→結果表示）を一緒に通す。
- 残した軽微項目: CreateInterviewModal 内個別ラベルの htmlFor（[49] polish）、gray-400 placeholder コントラスト（[56]一部・装飾的）。

## 注意（並行セッション・未コミット変更）
- prisma/migrations に未コミット変更あり（20260520051124_init 削除 / 20260101000000_init 追加 / migration_lock.toml を sqlite→postgresql）。別セッションの作業のため**このQAコミットには含めない**。

## 完了ログ（直近5件）
- 2026-07-16: リリース可否QA。多エージェントUX/UI監査で58件を確定→全修正（カメラ潰れ/権限拒否デッドエンド/公開ページ漏洩/エラーハンドリング/レスポンシブ/コピー・a11y）。tsc通過。ブランチ qa/release-readiness
- 2026-07-09: 自己改善ループを gallery / Ideation にも導入して push。本リポジトリのコミット4件も push（PR #1 に反映）
- 2026-07-09: リモート実行対応（ハイブリッド構成）— 運用ルール全文と /kaizen をリポジトリにも再配置、kaizen に同期チェック手順を追加
- 2026-07-09: 自己改善ループをグローバル化（/kaizen と運用ルールを ~/.claude/ へ昇格、全リポジトリで有効に）
- 2026-07-09: 自己改善ワークフロー導入（STATE.md / LESSONS.md / DECISIONS.md / /kaizen スキル / ship 検証ループ）
