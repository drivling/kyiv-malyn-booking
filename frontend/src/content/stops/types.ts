export type StopArticle = {
  /** Stable stop id, e.g. st_0019 */
  id: string;
  /** Display name (uk) */
  name: string;
  /** One short SEO paragraph (uk) */
  lead: string;
  /** Optional short tips */
  tips?: string[];
};
