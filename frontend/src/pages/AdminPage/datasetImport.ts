/**
 * Розбір файлу для «Імпорт датасету з файлу…» (DatasetImportButton, фаза 8 плану Коростеня).
 */
import type { TransportDataset } from '@/api/transportDataset';

const ARRAYS = ['stops', 'routes', 'routeStops', 'trips', 'segments'] as const;

/** Розібрати файл; помилка — зрозумілим текстом. Глибоку перевірку робить сервер (той самий валідатор, що й завжди). */
export function parseImportedDataset(text: string): TransportDataset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл — не JSON');
  }
  const d = raw as Record<string, unknown>;
  if (!d || typeof d !== 'object') throw new Error('Файл — не датасет транспорту');
  for (const key of ARRAYS) {
    if (!Array.isArray(d[key])) throw new Error(`У файлі нема масиву «${key}» — це не датасет транспорту`);
  }
  if (!d.meta || typeof d.meta !== 'object') throw new Error('У файлі нема «meta»');
  const stops = d.stops as Array<Record<string, unknown>>;
  if (!stops.length) throw new Error('У файлі нема жодної зупинки');
  const bad = stops.find((s) => typeof s.id !== 'string' || typeof s.lat !== 'number' || typeof s.lng !== 'number');
  if (bad) throw new Error(`Зупинка без id або координат: ${JSON.stringify(bad).slice(0, 120)}`);
  return d as unknown as TransportDataset;
}

const count = (d: Pick<TransportDataset, 'stops' | 'routes' | 'trips'> | null | undefined, key: 'stops' | 'routes' | 'trips'): number => d?.[key]?.length ?? 0;

/** Текст підтвердження: що було → що стане */
export function importConfirmText(cityName: string, current: TransportDataset | null, next: TransportDataset): string {
  return (
    `Замінити датасет транспорту міста ${cityName} вмістом файлу?\n` +
    `Зупинок: ${count(current, 'stops')} → ${count(next, 'stops')}, маршрутів: ${count(current, 'routes')} → ${count(next, 'routes')}, ` +
    `рейсів: ${count(current, 'trips')} → ${count(next, 'trips')}.\n` +
    'Усе, що зараз у базі для цього міста, буде замінено (у журналі ревізій лишиться запис).'
  );
}
