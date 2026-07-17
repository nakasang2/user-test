# DECISIONS

## 現在の前提・絶対ルール
- `prisma db push` は directUrl（DB直結）経由で実行する。ビルド時の pooler 経由接続は P1017 で不安定（2026-06 に3回失敗して確立したルール）
- push 前のローカルビルド検証（`npx tsc --noEmit` + `npx next build`）を省略しない
- **本番URL**: https://user-test-nakasang2s-projects.vercel.app/ （Vercel: user-test / GitHub: nakasang2/user-test → main が本番）。反映確認はここで行う。※ `user-test.vercel.app`（末尾に -projects なし）は別の create-react-app 製サイトで無関係
- このセッション種別（sandbox）からは `git push` / `next build`（Google Fonts遮断）/ Vercel URLへの画面遷移 が不可。push・merge はユーザーのローカル端末、本番確認は preview ブラウザの `fetch`（外部到達可）で行う

## 並行セッションの担当
- prisma/migrations の整理（20260520051124_init 削除 → 20260101000000_init 追加）が未コミットで存在。別セッションの作業の可能性があるため、このセッション（自己改善ワークフロー導入）では触らない・コミットしない

---

## 2026-07-09 リモート実行（claude.ai Webセッション等）への対応
- 決定: A案（ハイブリッド）。グローバル設定（~/.claude/）は維持しつつ、リモートでも使うリポジトリには運用ルール全文（AGENTS.md）と .claude/skills/kaizen もコミットする。まず本リポジトリに適用
- 却下: B案（リポジトリを正としグローバル削除）— 新規リポジトリごとに導入作業が必要になるため
- 却下: C案（現状維持）— リモート実行時に運用ルールと /kaizen が効かないため
- 補足: 二重管理のズレは /kaizen の「同期チェック」手順（ローカル実行時にグローバル側と差分確認）で防ぐ

## 2026-07-09 自己改善ループの展開方法（複数リポジトリ対応）
- 決定: A案（グローバル化）。/kaizen スキルと運用ルールを ~/.claude/（PC全体の設定）へ昇格し、全リポジトリで自動有効化。台帳（STATE/LESSONS/DECISIONS）は各リポジトリの docs/ に必要になった時点で作成
- 却下: B案（各リポジトリへコピー）— 仕組みを改良するたびに全リポジトリへ反映する手間が発生するため
- 補足: これに伴い、このリポジトリ内の重複（AGENTS.md の運用ルール詳細・.claude/skills/kaizen）は削除。docs/ の台帳3ファイルはこのリポジトリの資産としてそのまま残す

## 2026-07-09 自己改善型AIエージェント化の適用先
- 決定: A案（開発ワークフロー強化）。Claude Code の運用自体に自己改善ループを導入する
  - docs/STATE.md（セッション横断の作業状態）/ docs/LESSONS.md（失敗・成功パターン台帳）/ 3回ルールで昇格提案 / ship スキルに別視点レビュー（検証ループ）を追加 / /kaizen スキルで定期棚卸し
- 却下: B案（プロダクトのAIインタビュアー自体への自己改善組み込み）— 価値はあるが数週間規模。まずA案で基盤を作ってから再検討
- 却下: C案（記事どおりの Python 自作フレームワーク）— Claude Code の既存機能（メモリ・スキル・サブエージェント）と重複し、保守負担が過大
- 参考: X記事「【Claude Fable 5】無料期間で構築する自己改善型AIエージェントシステム」(@claudecode84)。記事の「Fable 5 フレームワーク」は実在せず筆者の創作だが、設計パターン（STATE.md / Verification Loop / Memory / Skills / Human-in-the-Loop）は有効と判断し、Claude Code ネイティブ機能で実装
