/**
 * «Доведе» — орієнтири без зупинок (nlu/landmarks.ts): як їх називають, перевага зупинок і кураторських місць,
 * однойменні місця, копія назв на бекенді.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import stopsDoc from '../eval/malyn-stops.json';
import { composeStories } from '../compose/composeStories';
import type { LocalPlanner } from '../compose/types';
import { PLACES } from './gazetteer';
import { LANDMARKS, landmarkPlace } from './landmarks';
import { parseLocal } from './parseLocal';
import { resolvePlace } from './places';
import { buildStopPlaces } from './stopPlaces';
import { STREETS } from './streets';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const STOPS = buildStopPlaces((stopsDoc as unknown as { stops: { id: string; name: string }[] }).stops);
const parse = (text: string) => parseLocal(text, NOW, STOPS).intent;

describe('«Доведе» — орієнтири', () => {
  it('дані: унікальні id, точка в межах міста, id не перетинаються з іншими місцями', () => {
    expect(LANDMARKS.length).toBeGreaterThan(150);
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length);
    const other = new Set([...PLACES.map((p) => p.id), ...STREETS.map((s) => s.id)]);
    for (const l of LANDMARKS) {
      expect(l.id).toMatch(/^lm\.[a-z0-9-]+$/);
      expect(other.has(l.id)).toBe(false);
      expect(l.lat).toBeGreaterThan(50.7);
      expect(l.lat).toBeLessThan(50.85);
      expect(l.lng).toBeGreaterThan(29.1);
      expect(l.lng).toBeLessThan(29.4);
      expect(l.said[0]).toBe(l.name);
    }
  });

  it('розуміє, як місце називають люди: скорочення, відмінки, російською', () => {
    expect(parse('з вокзалу до АТБ').to?.id).toBe('lm.atb-market');
    expect(parse('як доїхати до пенсійного фонду з автостанції').to?.id).toBe('lm.pensiinyi-fond');
    expect(parse('мені в пенсійний').to?.id).toBe('lm.pensiinyi-fond');
    expect(parse('від вокзалу до суду').to?.id).toBe('lm.malynskyi-raionnyi-sud');
    expect(parse('до поліції').to?.id).toBe('lm.malynske-viddilennia-politsii-1');
    expect(parse('з центру до податкової').to?.id).toBe('lm.malynska-dpi');
    expect(parse('до садка 8 з вокзалу').to?.id).toBe('lm.dnz-8-ialynka');
    expect(parse('до нової пошти 3').to?.id).toBe('lm.nova-poshta-viddilennia-3');
    expect(parse('в налоговую').to?.id).toBe('lm.malynska-dpi');
    expect(parse('з хлібозаводу на вокзал')).toMatchObject({ from: { id: 'lm.vat-malynskyi-khlibozavod' }, to: { id: 'malyn.vokzal' } });
  });

  it('місце — це точка без зупинок, з підписом', () => {
    const p = resolvePlace('lm.atb-market');
    expect(p).toMatchObject({ city: 'Malyn', label: 'супермаркет АТБ-Маркет' });
    expect(p?.latLng).toHaveLength(2);
    expect(p?.stopIds).toBeUndefined();
    expect(landmarkPlace('lm.nema-takoho')).toBeUndefined();
  });

  it('кураторське місце й зупинка з такою самою назвою мають перевагу; без прийменника орієнтир не беремо', () => {
    expect(parse('до лікарні').to?.id).toBe('malyn.likarnia');
    expect(parse('до вокзалу').to?.id).toBe('malyn.vokzal');
    // «Сонечко» — і зупинка, і садок, і магазин: туди, куди їде автобус
    expect(parse('до сонечка').to?.id).toMatch(/^st_/);
    expect(parse('дружба народів').to).toBeNull();
    expect(parse('з Києва в Малин завтра зранку')).toMatchObject({ from: { id: 'city.Kyiv' }, to: { id: 'city.Malyn' } });
  });

  it('однойменні місця: береться ближче до центру, і воно знає про «двійників»', () => {
    const twins = LANDMARKS.filter((l) => l.twins);
    expect(twins.length).toBeGreaterThan(0);
    const avrora = parse('до аврори').to?.id;
    expect(avrora).toBe('lm.avrora');
    expect(LANDMARKS.find((l) => l.id === 'lm.avrora')?.twins).toBe(2);
  });

  it('поїздка до орієнтира: планувальник дістає точку; про однойменні місця відповідь каже прямо', () => {
    const calls: unknown[] = [];
    const planner: LocalPlanner = {
      plan: (from, to) => {
        calls.push([from, to]);
        return {
          journeys: [
            {
              departMins: 15 * 60,
              arriveMins: 15 * 60 + 25,
              transfers: 0,
              legs: [
                { kind: 'transit', routeId: '5', tripId: 't', direction: 'there', variantId: null, boardStopId: 'st_0019', alightStopId: 'st_a', depMins: 15 * 60, arrMins: 15 * 60 + 19, stopIds: ['st_0019', 'st_a'], times: [] },
                { kind: 'walk', from: { stopId: 'st_a' }, to: { lat: 1, lng: 2 }, depMins: 15 * 60 + 19, arrMins: 15 * 60 + 25, meters: 420 },
              ],
            },
          ],
        };
      },
      stopName: (id) => id,
      stopCoords: () => [50.77, 29.24],
    } as unknown as LocalPlanner;
    const atb = LANDMARKS.find((l) => l.id === 'lm.atb-market')!;
    const one = composeStories({ intent: parse('з вокзалу до АТБ'), now: NOW, date: NOW.date, schedules: [], planner });
    expect(calls[0]).toEqual([{ kind: 'stop', stopId: 'st_0019' }, { kind: 'point', lat: atb.lat, lng: atb.lng }]);
    expect(one.kind === 'stories' && one.stories[0].endNote).toBeNull();
    const twin = composeStories({ intent: parse('з вокзалу до аврори'), now: NOW, date: NOW.date, schedules: [], planner });
    expect(twin.kind === 'stories' && twin.stories[0].endNote).toMatch(/У місті кілька місць із назвою «Аврора»/);
  });

  it('повна назва з підказки розбирається в місце, яке так називають', () => {
    for (const l of LANDMARKS) {
      const got = parse(`до ${l.name}`).to;
      const lm = LANDMARKS.find((x) => x.id === got?.id);
      // зупинка чи кураторське місце з такою назвою — теж правильна відповідь
      if (got && !lm) continue;
      // однойменне місце (той самий заклад на іншій вулиці чи під іншою вивіскою) — теж воно
      expect(lm?.said, `до ${l.name}`).toContain(l.name);
    }
  });

  it('бекенд знає ті самі орієнтири (backend/src/dovede/landmarks.ts)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/src/dovede/landmarks.ts'), 'utf8');
    const ids = [...src.matchAll(/"id": "(lm\.[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(LANDMARKS.map((l) => l.id));
  });
});
