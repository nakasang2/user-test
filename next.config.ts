import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // スライド画像生成（next/og の ImageResponse）で日本語フォントを読み込むため、
  // node_modules 内のフォントファイルがサーバーレス関数のバンドルから
  // 除外されないよう明示する（Next.js の自動トレースが見落とすことがあるため）
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@fontsource/noto-sans-jp/files/**/*"],
  },
};

export default nextConfig;
