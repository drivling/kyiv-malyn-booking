import { sameAnswer } from '@/pages/DovedePage/nlu/merge';
import { parseLocal } from '@/pages/DovedePage/nlu/parseLocal';
import type { RouteLike } from '@/pages/DovedePage/nlu/routes';
import type { StopPlace } from '@/pages/DovedePage/nlu/stopPlaces';
import type { KyivNow, TripIntent } from '@/pages/DovedePage/nlu/types';
import { spokenNumbersToDigits } from './spokenNumbers';

export interface VoiceMatch {
  /** розбір розпізнаного тексту веде до тієї самої відповіді, що й розбір набраної фрази */
  match: boolean;
  /** розпізнаний текст після заміни чисел словами на цифри — саме його розбирав словник */
  heardText: string;
  ref: TripIntent;
  heard: TripIntent;
}

/**
 * Головний показник якості голосу: розбираємо набраний еталон і розпізнаний текст тим самим словником сторінки
 * (`parseLocal`, перед ним — числа словами → цифри) і звіряємо правилом, яким сервер порівнює розбір браузера з розбором Claude (`sameAnswer`).
 * Помилка в слові, яку словник усе одно впізнає, нам не шкодить; помилка в місці чи часі — шкодить.
 */
export function compareHeard(refText: string, heardText: string, now: KyivNow, stops: StopPlace[] = [], routes: RouteLike[] = []): VoiceMatch {
  const ref = parseLocal(refText, now, stops, routes).intent;
  const normalized = spokenNumbersToDigits(heardText);
  const heard = parseLocal(normalized, now, stops, routes).intent;
  return { match: sameAnswer(ref, heard), heardText: normalized, ref, heard };
}
