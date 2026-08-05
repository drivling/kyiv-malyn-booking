import { useEffect } from 'react';

/** Оновлює document.title і <link rel="canonical"> для SPA-сторінок */
export function usePageSeo(title: string, canonicalUrl: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const created = !link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    const prevHref = link.href;
    link.href = canonicalUrl;

    return () => {
      document.title = prevTitle;
      if (link) {
        if (created) link.remove();
        else link.href = prevHref;
      }
    };
  }, [title, canonicalUrl]);
}
