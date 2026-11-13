import { describe, expect, it } from 'vitest';
import type { TripIntent } from '../nlu/types';
import { intentToParams, paramsToIntent } from './url';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const base: TripIntent = {
  intent: 'trip',
  from: { id: 'kyiv.sviatoshyn', text: 'Києва (Святошин)' },
  to: { id: 'malyn.vokzal', text: 'вокзал моєї бабусі на Грушевського 5' },
  when: { day: 'tomorrow', time: '09:00', kind: 'arrive' },
  modes: ['elektrichka'],
  unknown: [],
  confidence: 'high',
};

describe('«Доведе» — адреса відповіді', () => {
  it('в адресі лише id, дата, час і транспорт — жодного слова з питання', () => {
    const q = intentToParams(base, '2026-11-14');
    expect(q.toString()).toBe('f=kyiv.sviatoshyn&t=malyn.vokzal&d=2026-11-14&h=09%3A00&a=1&m=elektrichka');
    expect(decodeURIComponent(q.toString())).not.toMatch(/[а-яіїєґ]/i);
  });

  it('туди й назад — той самий намір', () => {
    const back = paramsToIntent(intentToParams(base, '2026-11-14'), NOW);
    expect(back).toMatchObject({ from: { id: 'kyiv.sviatoshyn' }, to: { id: 'malyn.vokzal' }, when: { day: 'tomorrow', time: '09:00', kind: 'arrive' }, modes: ['elektrichka'] });
  });

  it('частина дня, дальня дата, без «звідки»', () => {
    const intent: TripIntent = { ...base, from: null, when: { day: '2026-11-20', kind: 'depart', part: 'morning' }, modes: [] };
    const q = intentToParams(intent, '2026-11-20');
    expect(q.toString()).toBe('t=malyn.vokzal&d=2026-11-20&p=morning');
    expect(paramsToIntent(q, NOW)).toMatchObject({ from: null, when: { day: '2026-11-20', part: 'morning', kind: 'depart' }, confidence: 'medium' });
  });

  it('давнє посилання з минулою датою відкривається на сьогодні', () => {
    expect(paramsToIntent(new URLSearchParams('f=city.Kyiv&t=city.Malyn&d=2026-10-01'), NOW)?.when.day).toBe('today');
  });

  it('сміття в адресі не стає наміром', () => {
    expect(paramsToIntent(new URLSearchParams('f=city.Lviv&t=<script>'), NOW)).toBeNull();
    expect(paramsToIntent(new URLSearchParams(''), NOW)).toBeNull();
    const i = paramsToIntent(new URLSearchParams('t=city.Malyn&h=99:99&m=teleport,marshrutka,marshrutka&p=night'), NOW);
    expect(i).toMatchObject({ when: { day: 'today', kind: 'depart' }, modes: ['marshrutka'] });
    expect(i?.when.time).toBeUndefined();
  });
});
