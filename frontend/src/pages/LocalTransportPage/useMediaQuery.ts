import { useEffect, useState } from 'react';

/** Телефон: одна колонка, карта — лише в повноекранному overlay */
export const PHONE_QUERY = '(max-width: 767px)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false; // jsdom / SSR
  return window.matchMedia(query).matches;
}

/** Реактивний media query з guard-ом для jsdom (там matchMedia немає або замокано як false). */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    setValue(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, [query]);
  return value;
}
