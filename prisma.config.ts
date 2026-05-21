import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // prisma/config の env() はモジュール評価時に即時検証して throw するため
    // process.env で直接読む（Vercel の環境変数はここで利用可能）
    url: process.env.DATABASE_URL ?? "",
  },
});
