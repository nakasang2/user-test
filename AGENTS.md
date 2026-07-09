<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:self-improvement-loop -->
# 自己改善ループ（このリポジトリの運用ルール）

このリポジトリでは Claude Code を「実行のたびに賢くなる」自己改善型で運用する。中心は docs/ の3ファイル。

1. **セッション開始時**: docs/STATE.md → docs/DECISIONS.md の順に読み、現状を把握してから作業に入る。
2. **STATE.md の更新**: 作業の節目・中断時・ship 後に docs/STATE.md を更新する（進行中 / 再開ポイント / 完了ログ）。
3. **失敗の記録**: ビルド・デプロイの失敗やユーザーからの修正指摘が起きたら、対応した直後に docs/LESSONS.md へ「事象 → 原因 → 回避策」を追記する。同種の作業を始める前に該当カテゴリを読み、同じ失敗を繰り返さない。
4. **3回ルール（昇格）**: 同種パターンが3回（×3）に達したら、DECISIONS.md の絶対ルール化か .claude/skills/ のスキル化をユーザーに提案する。勝手に恒久ルール化しない（Human-in-the-Loop）。
5. **検証ループ**: push 前は ship スキルに従い、ビルド検証に加えて /code-review による別視点レビューを行う。
6. **棚卸し**: 「一区切り」のタイミングで /kaizen を実行し、台帳の整理と昇格提案を行う。
<!-- END:self-improvement-loop -->
