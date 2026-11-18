import { describe, expect, it } from 'vitest';
import type { TripIntent } from '../nlu/types';
import { intentToParams, paramsToIntent, questionForUrl, questionFromParams, recallQuestion, rememberQuestion } from './url';

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
  it('id, дата, час і транспорт — без слів питання (вони окремо, у q=)', () => {
    const q = intentToParams(base, '2026-11-14');
    expect(q.toString()).toBe('f=kyiv.sviatoshyn&t=malyn.vokzal&d=2026-11-14&h=09%3A00&a=1&m=elektrichka');
    expect(decodeURIComponent(q.toString())).not.toMatch(/[а-яіїєґ]/i);
  });

  it('слова питання йдуть у посилання цілком, разом з адресою', () => {
    expect(questionForUrl('  з Києва на вокзал  ')).toBe('з Києва на вокзал');
    expect(questionForUrl('з Городищанської 20 на вокзал')).toBe('з Городищанської 20 на вокзал');
    expect(questionForUrl('')).toBeNull();
    expect(questionForUrl('а'.repeat(301))).toBeNull();
    expect(questionFromParams(new URLSearchParams('q=%20%D0%B4%D0%BE%20%D0%90%D0%A2%D0%91%20'))).toBe('до АТБ');
  });

  it('вкладка памʼятає питання для своєї відповіді — і лише для неї', () => {
    const params = new URLSearchParams('f=malyn.vokzal&t=street.horodyshchanska&d=2026-11-14');
    rememberQuestion(params, 'з вокзалу на Городищанську 20');
    expect(recallQuestion(new URLSearchParams('t=street.horodyshchanska&f=malyn.vokzal&d=2026-11-14'))).toBe('з вокзалу на Городищанську 20');
    expect(recallQuestion(new URLSearchParams('f=malyn.vokzal&t=malyn.tsentr&d=2026-11-14'))).toBe('');
    rememberQuestion(params, '');
    expect(recallQuestion(params)).toBe('');
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

  it('місце словами в Києві чи Житомирі їде в `fd=` / `td=`; з іншим місцем — ігнорується', () => {
    const intent: TripIntent = { intent: 'trip', from: { id: 'city.Malyn', text: 'Малина' }, to: { id: 'city.Zhytomyr', text: 'Житомир', detail: 'Польова 12' }, when: { day: 'today', kind: 'depart' }, modes: [], unknown: [], confidence: 'high' };
    const params = intentToParams(intent, '2026-11-13');
    expect(params.get('td')).toBe('Польова 12');
    expect(params.get('fd')).toBeNull();
    expect(paramsToIntent(params, { date: '2026-11-13', mins: 600 })?.to).toMatchObject({ id: 'city.Zhytomyr', detail: 'Польова 12' });
    const alien = new URLSearchParams('f=city.Malyn&t=malyn.vokzal&td=Польова&d=2026-11-13');
    expect(paramsToIntent(alien, { date: '2026-11-13', mins: 600 })?.to?.detail).toBeUndefined();
  });

  it('зупинка Коростеня в коридорі Малин ↔ Коростень (етап 3) — теж `fd=` / `td=`', () => {
    const korosten = new URLSearchParams('f=city.Korosten&fd=Пашини&t=malyn.paperova&d=2026-11-13');
    expect(paramsToIntent(korosten, { date: '2026-11-13', mins: 600 })?.from).toMatchObject({ id: 'city.Korosten', detail: 'Пашини' });
  });
});
