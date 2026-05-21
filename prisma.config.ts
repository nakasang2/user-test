import { defineConfig } from "prisma/config";

// datasource の url は schema.prisma の env("DATABASE_URL") で管理する。
// ここで env() を呼ぶと設定ファイル評価時に即時検証されてしまい、
// Vercel のビルド環境で DATABASE_URL が未設定だとエラーになるため削除。
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
});
