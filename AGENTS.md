<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:self-improvement-loop -->
# 自己改善ループ（このリポジトリの運用ルール）

このリポジトリは Claude を「実行のたびに賢くなる」自己改善型で運用する。ローカルの `~/.claude/` にも同じルールがあるが、リモート実行（claude.ai の Web セッション等）でも効くよう本文をここに置く（ハイブリッド構成）。

1. **セッション開始時**: docs/STATE.md → docs/DECISIONS.md の順に読み、現状を把握してから作業に入る。
2. **STATE.md の更新**: 作業の節目・中断時・出荷後に docs/STATE.md を更新する（進行中 / 再開ポイント / 完了ログ。完了ログは直近5件まで）。
3. **失敗の記録**: ビルド・デプロイの失敗やユーザーからの修正指摘に対応した直後、docs/LESSONS.md へ「事象 → 原因 → 回避策」を1エントリ追記する（再発は新規追加せず ×N を加算）。同種の作業を始める前に該当カテゴリを読み、同じ失敗を繰り返さない。
4. **3回ルール（昇格）**: 同種パターンが ×3 に達したら、DECISIONS.md の絶対ルール化かスキル化をユーザーに提案する。勝手に恒久ルール化しない（Human-in-the-Loop）。
5. **検証ループ**: push 前にビルド検証（`npx tsc --noEmit` + `npx next build`）と /code-review による別視点レビューを必ず行う。ローカルではさらに ship スキルの手順（本番反映確認まで）に従う。
6. **棚卸し**: 「一区切り」のタイミングで /kaizen（.claude/skills/kaizen）を実行し、台帳の整理と昇格提案を行う。
<!-- END:self-improvement-loop -->
