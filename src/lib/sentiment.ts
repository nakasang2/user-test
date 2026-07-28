/**
 * 感情ラベルの正規化。サーバー（AI 出力の保存時）とクライアント（表示時）の
 * 両方から使うため、サーバー依存を持たない独立ファイルに置く。
 * 実装が2箇所に分かれると判定がズレるので、必ずここを共通で使うこと。
 */
export type Sentiment = 'positive' | 'neutral' | 'negative'

/**
 * 文字列を positive/neutral/negative のいずれかに正規化する。
 * 旧データは "negative - ... though positive about pricing" のように
 * 説明文へ反対の極性語が混ざるため、固定順ではなく
 * 「最初に出現した語」を採用する（先頭の語がその文の結論）。
 */
export function normalizeSentiment(raw: unknown): Sentiment | null {
  if (typeof raw !== 'string') return null
  const s = raw.toLowerCase()
  const found = (['positive', 'negative', 'neutral'] as const)
    .map((word) => ({ word, at: s.indexOf(word) }))
    .filter((x) => x.at !== -1)
    .sort((a, b) => a.at - b.at)
  return found[0]?.word ?? null
}
