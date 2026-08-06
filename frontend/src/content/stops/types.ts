export type StopArticle = {
  /** Stable stop id, e.g. st_0019 */
  id: string;
  /** Display name (uk) */
  name: string;
  /**
   * Legacy single paragraph (older pilot articles).
   * Prefer structured fields below for new content.
   */
  lead?: string;
  /** Place / role in the city (uk), without CTA or coordinates */
  place?: string;
  /** Route numbers that serve this stop (for bold chips) */
  routeIds?: string[];
  /** WGS84 lat, lng */
  coords?: [number, number];
  /** Optional short tips */
  tips?: string[];
};

/** Text for meta description / prerender fallback */
export function stopArticlePlainText(article: StopArticle): string {
  if (article.place) {
    const routes =
      article.routeIds && article.routeIds.length
        ? ` Маршрути: ${article.routeIds.map((r) => `№${r}`).join(', ')}.`
        : '';
    return `Зупинка «${article.name}» у Малині — ${article.place}.${routes}`;
  }
  return article.lead?.trim() || `Зупинка «${article.name}» у Малині.`;
}
