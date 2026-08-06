import { useEffect } from 'react';

export type PageSeoOptions = {
  title: string;
  canonicalUrl: string;
  description?: string;
  /** JSON-LD object or @graph; injected as application/ld+json */
  jsonLd?: object;
  /** DOM id for the JSON-LD script (default: page-seo-jsonld) */
  jsonLdId?: string;
};

function upsertMetaByName(name: string, content: string): () => void {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  const created = !el;
  const prev = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (prev != null) el.setAttribute('content', prev);
  };
}

function upsertMetaByProperty(property: string, content: string): () => void {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  const created = !el;
  const prev = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (prev != null) el.setAttribute('content', prev);
  };
}

/** Inject or replace a JSON-LD script; returns cleanup. */
export function upsertJsonLd(id: string, data: object): () => void {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  const created = !el;
  const prevText = el?.textContent ?? null;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (prevText != null) el.textContent = prevText;
  };
}

/**
 * SPA SEO: title, canonical, optional description + Open Graph + JSON-LD.
 * Overload: usePageSeo(title, canonicalUrl) or usePageSeo(options).
 */
export function usePageSeo(title: string, canonicalUrl: string): void;
export function usePageSeo(options: PageSeoOptions): void;
export function usePageSeo(titleOrOptions: string | PageSeoOptions, canonicalUrl?: string): void {
  const options: PageSeoOptions =
    typeof titleOrOptions === 'string'
      ? { title: titleOrOptions, canonicalUrl: canonicalUrl! }
      : titleOrOptions;

  const { title, canonicalUrl: canonical, description, jsonLd, jsonLdId = 'page-seo-jsonld' } = options;
  const jsonLdSerialized = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const createdLink = !link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    const prevHref = link.href;
    link.href = canonical;

    const restores: Array<() => void> = [];
    if (description) {
      restores.push(upsertMetaByName('description', description));
      restores.push(upsertMetaByProperty('og:description', description));
    }
    restores.push(upsertMetaByProperty('og:title', title));
    restores.push(upsertMetaByProperty('og:url', canonical));
    restores.push(upsertMetaByProperty('og:type', 'website'));
    restores.push(upsertMetaByProperty('og:locale', 'uk_UA'));

    let restoreJsonLd: (() => void) | undefined;
    if (jsonLdSerialized) {
      restoreJsonLd = upsertJsonLd(jsonLdId, JSON.parse(jsonLdSerialized) as object);
    }

    return () => {
      document.title = prevTitle;
      if (link) {
        if (createdLink) link.remove();
        else link.href = prevHref;
      }
      for (const restore of restores) restore();
      restoreJsonLd?.();
    };
  }, [title, canonical, description, jsonLdSerialized, jsonLdId]);
}
