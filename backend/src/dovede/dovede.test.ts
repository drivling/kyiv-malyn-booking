/**
 * «Доведе», фаза 2: контракт наміру, стабільність промпту, виклик Claude (із заглушкою SDK — без мережі).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { PLACES } from './gazetteer';
import { INTENT_SCHEMA, IntentShapeError, validateIntent } from './intent';
import { PROMPT_VERSION, buildSystemPrompt, buildUserText, weekdayUk } from './prompt';
import { DEFAULT_DOVEDE_MODEL, createUnderstand, dovedeModelName, understandFromEnv, type DovedeMessagesClient } from './understand';
import { dovedeDailyCap, isDovedeEnabled, kyivDayStart } from './guard';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };

const STOPS = [
  { id: 'st_0071', name: 'Поворот на Коновальця' },
  { id: 'st_0064', name: 'Паперова фабрика Вайдманн' },
  { id: 'st_0101', name: 'Швейна фабрика' },
  { id: 'st_0102', name: 'Швейна фабрика (навпроти)' },
  { id: 'st_0160', name: '№5 т.3' },
];

const GOOD = {
  intent: 'trip',
  from: { id: 'kyiv.sviatoshyn', text: 'Києва (Святошин)' },
  to: { id: 'malyn.vokzal', text: 'вокзал' },
  when: { day: 'today', time: null, kind: 'depart', part: null },
  modes: [],
  routes: [],
  unknown: [],
  confidence: 'high',
};

const ROUTES = [
  { id: '5', no: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
  { id: '11', no: '11/1', fromName: 'Паперова фабрика', toName: 'Залізничний вокзал' },
];

test('validateIntent: чистий намір проходить, null-поля часу зникають', () => {
  const i = validateIntent(GOOD);
  assert.equal(i.from?.id, 'kyiv.sviatoshyn');
  assert.equal(i.to?.id, 'malyn.vokzal');
  assert.deepEqual(i.when, { day: 'today', kind: 'depart' });
  assert.equal(i.confidence, 'high');
});

test('validateIntent: id, якого немає в словнику, стає null, а текст іде в unknown', () => {
  const i = validateIntent({ ...GOOD, from: { id: 'city.Lviv', text: 'Львова' } });
  assert.equal(i.from, null);
  assert.deepEqual(i.unknown, ['Львова']);
  assert.equal(i.confidence, 'medium', 'з невідомим місцем «high» не буває');
});

test('validateIntent: сміття в полях замінюється безпечними значеннями', () => {
  const i = validateIntent({
    intent: 'hack',
    from: 'Київ',
    to: { id: 'malyn.vokzal', text: 'x'.repeat(500) },
    when: { day: 'колись', time: '25:99', kind: 'soon', part: 'night' },
    modes: ['marshrutka', 'teleport', 'marshrutka'],
    unknown: [1, 'Ковалівка', 'Ковалівка'],
    confidence: 'sure',
  });
  assert.equal(i.intent, 'trip');
  assert.equal(i.from, null);
  assert.equal(i.to?.text.length, 80);
  assert.deepEqual(i.when, { day: 'today', kind: 'depart' });
  assert.deepEqual(i.modes, ['marshrutka']);
  assert.deepEqual(i.unknown, ['Ковалівка']);
  assert.equal(i.confidence, 'low');
});

test('validateIntent: не обʼєкт — IntentShapeError', () => {
  assert.throws(() => validateIntent('trip'), IntentShapeError);
  assert.throws(() => validateIntent(null), IntentShapeError);
  assert.throws(() => validateIntent([]), IntentShapeError);
});

test('системний промпт: байт-у-байт однаковий між викликами й містить кожен id словника', () => {
  const a = buildSystemPrompt();
  const b = buildSystemPrompt();
  assert.equal(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'));
  assert.ok(a.startsWith(`[${PROMPT_VERSION}]`));
  for (const p of PLACES) assert.ok(a.includes(`- ${p.id} — `), `немає ${p.id}`);
  // у кожному розділі (словник, вулиці, орієнтири) місця йдуть за id — порядок у джерелі на кеш не впливає
  for (const section of a.split(/^## /m)) {
    const ids = [...section.matchAll(/^- ([\w.-]+) — /gm)].map((m) => m[1]);
    assert.deepEqual(ids, [...ids].sort(), `розділ «${section.split('\n')[0]}» не відсортований за id`);
  }
});

test('системний промпт не знає «зараз»: дата й час — лише в повідомленні користувача', () => {
  assert.ok(!/20\d\d-\d\d-\d\d/.test(buildSystemPrompt()));
  const u = buildUserText('з Києва в Малин', NOW);
  assert.ok(u.includes('2026-11-13, пʼятниця, 14:20'));
  assert.ok(u.includes('<question>\nз Києва в Малин\n</question>'));
  assert.equal(weekdayUk('2026-11-15'), 'неділя');
});

test('схема відповіді: усі поля обовʼязкові, зайвих немає (вимога structured outputs)', () => {
  assert.equal(INTENT_SCHEMA.additionalProperties, false);
  assert.deepEqual([...INTENT_SCHEMA.required].sort(), Object.keys(INTENT_SCHEMA.properties).sort());
  assert.deepEqual([...INTENT_SCHEMA.properties.when.required].sort(), Object.keys(INTENT_SCHEMA.properties.when.properties).sort());
});

type CreateArgs = { body: Record<string, unknown>; options: Record<string, unknown> | undefined };

function stubClient(reply: unknown | (() => never)): { client: DovedeMessagesClient; calls: CreateArgs[] } {
  const calls: CreateArgs[] = [];
  const create = async (body: Record<string, unknown>, options?: Record<string, unknown>) => {
    calls.push({ body, options });
    if (typeof reply === 'function') (reply as () => never)();
    return reply;
  };
  return { client: { beta: { messages: { create } } } as unknown as DovedeMessagesClient, calls };
}

const message = (over: Record<string, unknown>) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(GOOD) }],
  usage: { input_tokens: 40, output_tokens: 90, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 },
  ...over,
});

test('understand: запит — structured output, low effort, кешований системний промпт, серверний fallback', async () => {
  const { client, calls } = stubClient(message({}));
  const r = await createUnderstand({ client })('з Києва (Святошин) на вокзал', NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.intent.to?.id, 'malyn.vokzal');
    assert.deepEqual(r.usage, { inputTokens: 40, outputTokens: 90, cacheReadTokens: 1800, cacheWriteTokens: 0 });
    assert.equal(r.promptVersion, PROMPT_VERSION);
  }
  const { body, options } = calls[0];
  assert.equal(body.model, DEFAULT_DOVEDE_MODEL);
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'low', format: { type: 'json_schema', schema: INTENT_SCHEMA } });
  assert.deepEqual(body.system, [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }]);
  assert.equal('thinking' in body, false);
  assert.deepEqual(body.messages, [{ role: 'user', content: buildUserText('з Києва (Святошин) на вокзал', NOW) }]);
  assert.deepEqual(options, { timeout: 8000, maxRetries: 1 });
});

test('understand: відмова, обрізана відповідь і не-JSON — не виняток, а failure', async () => {
  const run = async (over: Record<string, unknown>) => createUnderstand({ client: stubClient(message(over)).client })('x', NOW);
  const refusal = await run({ stop_reason: 'refusal', content: [] });
  assert.deepEqual([refusal.ok, !refusal.ok && refusal.failure], [false, 'refusal']);
  const cut = await run({ stop_reason: 'max_tokens' });
  assert.deepEqual([cut.ok, !cut.ok && cut.failure], [false, 'max_tokens']);
  const junk = await run({ content: [{ type: 'text', text: 'Ось відповідь: …' }] });
  assert.deepEqual([junk.ok, !junk.ok && junk.failure], [false, 'invalid']);
  assert.equal(junk.usage?.outputTokens, 90, 'токени рахуємо й для невдалої відповіді');
});

test('understand: у журнал іде модель, що справді відповіла (після fallback)', async () => {
  const r = await createUnderstand({ client: stubClient(message({ model: 'claude-opus-5' })).client })('x', NOW);
  assert.equal(r.model, 'claude-opus-5');
});

test('understand: помилки SDK розкладено за типами', async () => {
  const failing = (e: Error) =>
    createUnderstand({
      client: stubClient(() => {
        throw e;
      }).client,
    })('x', NOW);
  const timeout = await failing(new Anthropic.APIConnectionTimeoutError());
  assert.equal(!timeout.ok && timeout.failure, 'timeout');
  const other = await failing(new Error('boom'));
  assert.equal(!other.ok && other.failure, 'api_error');
});

test('модель з env: лише claude-*, інакше типова', () => {
  assert.equal(dovedeModelName('claude-haiku-5-5'), 'claude-haiku-5-5');
  assert.equal(dovedeModelName('gpt-x'), DEFAULT_DOVEDE_MODEL);
  assert.equal(dovedeModelName(undefined), DEFAULT_DOVEDE_MODEL);
});

test('без ANTHROPIC_API_KEY клієнта немає', () => {
  assert.equal(understandFromEnv({}), null);
  assert.equal(understandFromEnv({ ANTHROPIC_API_KEY: '  ' }), null);
  assert.equal(typeof understandFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }), 'function');
});

test('перемикачі: DOVEDE_ENABLED і DOVEDE_DAILY_CAP', () => {
  assert.equal(isDovedeEnabled({}), true);
  assert.equal(isDovedeEnabled({ DOVEDE_ENABLED: '0' }), false);
  assert.equal(isDovedeEnabled({ DOVEDE_ENABLED: 'false' }), false);
  assert.equal(dovedeDailyCap({}), 300);
  assert.equal(dovedeDailyCap({ DOVEDE_DAILY_CAP: '25' }), 25);
  assert.equal(dovedeDailyCap({ DOVEDE_DAILY_CAP: '0' }), 0);
  assert.equal(dovedeDailyCap({ DOVEDE_DAILY_CAP: 'багато' }), 300);
});

test('київська доба починається о 00:00 за Києвом (взимку UTC+2)', () => {
  assert.equal(kyivDayStart(new Date('2026-11-13T12:20:30.000Z')).toISOString(), '2026-11-12T22:00:00.000Z');
});

test('промпт із зупинками міста: кожна пасажирська зупинка названа — своїм id або в місці словника', () => {
  const p = buildSystemPrompt(STOPS);
  assert.ok(p.includes('- st_0071 — Поворот на Коновальця'));
  assert.ok(p.includes('- st_0101 — Швейна фабрика'), 'обидва боки дороги — одне місце');
  assert.ok(!p.includes('st_0102'));
  assert.ok(/- malyn\.paperova — .*зупинки: Паперова фабрика Вайдманн/.test(p), 'зупинка кураторського місця — у його рядку');
  assert.ok(!p.includes('№5 т.3'), 'технічні точки геометрії Claude не потрібні');
  assert.equal(p, buildSystemPrompt([...STOPS].reverse()), 'порядок рядків у базі на промпт не впливає');
  assert.ok(!buildSystemPrompt().includes('## Зупинки міського транспорту'));
});

test('validateIntent: id зупинки з розкладу дозволений лише з переданим списком', () => {
  const raw = { ...GOOD, from: { id: 'st_0071', text: 'поворот на коновальця' } };
  assert.equal(validateIntent(raw, new Set(['st_0071'])).from?.id, 'st_0071');
  assert.equal(validateIntent(raw).from, null);
  assert.equal(validateIntent({ ...GOOD, from: { id: 'st_9999', text: 'десь' } }, new Set(['st_0071'])).from, null);
});

test('understand: зупинки міста йдуть у системний промпт, а їхні id проходять перевірку', async () => {
  const reply = { ...GOOD, from: { id: 'st_0071', text: 'поворот на коновальця' }, to: { id: 'malyn.paperova', text: 'паперова фабрика' } };
  const { client, calls } = stubClient(message({ content: [{ type: 'text', text: JSON.stringify(reply) }] }));
  const understand = createUnderstand({ client });
  const r = await understand('з поворот на коновальця до паперова фабрика', NOW, STOPS);
  assert.equal(r.ok && r.intent.from?.id, 'st_0071');
  const system = (calls[0].body.system as Array<{ text: string }>)[0].text;
  assert.equal(system, buildSystemPrompt(STOPS));
  await understand('ще раз', NOW, STOPS);
  assert.equal((calls[1].body.system as Array<{ text: string }>)[0].text, system, 'той самий список — той самий промпт (кеш)');
  const without = await understand('без зупинок', NOW);
  assert.equal(without.ok && without.intent.from, null, 'без списку id зупинки відкидається');
});

test('промпт із маршрутами міста: id, номер з борту й кінцеві; порядок у базі не важить', () => {
  const p = buildSystemPrompt(STOPS, ROUTES);
  assert.ok(p.includes('- 11 — автобус №11/1: Паперова фабрика — Залізничний вокзал'));
  assert.ok(p.includes('- 5 — автобус №5: Лікарня — Залізничний вокзал'));
  assert.equal(p, buildSystemPrompt(STOPS, [...ROUTES].reverse()));
  assert.ok(!buildSystemPrompt(STOPS).includes('## Маршрути міських автобусів'));
});

test('validateIntent: маршрути — лише зі списку міста; «route» без маршруту стає звичайним питанням', () => {
  const ids = new Set(['5', '11']);
  const about = validateIntent({ ...GOOD, intent: 'route', from: null, to: null, routes: ['5', '99', '5'] }, undefined, ids);
  assert.deepEqual([about.intent, about.routes, about.confidence], ['route', ['5'], 'high']);
  const none = validateIntent({ ...GOOD, intent: 'route', routes: ['99'] }, undefined, ids);
  assert.deepEqual([none.intent, none.routes], ['trip', undefined]);
  assert.equal(validateIntent({ ...GOOD, routes: ['5'] }).routes, undefined, 'без списку маршрутів id не приймаємо');
});

test('understand: маршрути йдуть у промпт, їхні id проходять перевірку', async () => {
  const reply = { ...GOOD, intent: 'route', from: null, to: null, routes: ['11'] };
  const { client, calls } = stubClient(message({ content: [{ type: 'text', text: JSON.stringify(reply) }] }));
  const r = await createUnderstand({ client })('розклад 11/1', NOW, STOPS, ROUTES);
  assert.deepEqual(r.ok && [r.intent.intent, r.intent.routes], ['route', ['11']]);
  assert.equal((calls[0].body.system as Array<{ text: string }>)[0].text, buildSystemPrompt(STOPS, ROUTES));
});

test('вулиці: id вулиці (з будинком чи без) дозволений; у промпті — назва й колишні назви', () => {
  assert.equal(validateIntent({ ...GOOD, from: { id: 'street.horodyshchanska', text: 'Городищанської 20' } }).from?.id, 'street.horodyshchanska');
  assert.equal(validateIntent({ ...GOOD, from: { id: 'street.horodyshchanska:22а', text: 'x' } }).from?.id, 'street.horodyshchanska:22а');
  assert.equal(validateIntent({ ...GOOD, from: { id: 'street.nema-takoi', text: 'Вигадана' } }).from, null);
  assert.equal(validateIntent({ ...GOOD, from: { id: 'street.horodyshchanska:20; drop', text: 'x' } }).from, null);
  const p = buildSystemPrompt();
  assert.ok(p.includes('- street.horodyshchanska — вулиця Городищанська'));
  assert.ok(/- street\.ukrainskykh-povstantsiv — вулиця Українських Повстанців \(кол\. .*Чапаєва/.test(p));
});

test('орієнтири: id зі списку дозволений, вигаданий — ні; у промпті — підпис і як ще кажуть', () => {
  assert.equal(validateIntent({ ...GOOD, to: { id: 'lm.atb-market', text: 'атб' } }).to?.id, 'lm.atb-market');
  const bad = validateIntent({ ...GOOD, to: { id: 'lm.epitsentr', text: 'епіцентр' } });
  assert.equal(bad.to, null);
  assert.ok(bad.unknown.includes('епіцентр'));
  const p = buildSystemPrompt();
  assert.ok(p.includes('- lm.atb-market — супермаркет АТБ-Маркет (кажуть: АТБ)'));
  assert.ok(p.includes('## Орієнтири Малина'));
});

test('«крім сімки»: avoidRoutes лише зі списку маршрутів; заборонений маршрут серед бажаних не лишається', () => {
  const ids = new Set(['5', '7']);
  const a = validateIntent({ ...GOOD, routes: ['5', '7'], avoidRoutes: ['7', '99', '7'] }, undefined, ids);
  assert.deepEqual(a.routes, ['5']);
  assert.deepEqual(a.avoidRoutes, ['7']);
  assert.equal(validateIntent({ ...GOOD, routes: [], avoidRoutes: [] }, undefined, ids).avoidRoutes, undefined);
  // питання про маршрут, де єдиний маршрут — заборонений, стає звичайною поїздкою
  assert.equal(validateIntent({ ...GOOD, intent: 'route', routes: ['7'], avoidRoutes: ['7'] }, undefined, ids).intent, 'trip');
  assert.ok(buildSystemPrompt().includes('avoidRoutes'));
});

test('синоніми йдуть у повідомлення з питанням, а системний промпт від них не залежить', () => {
  const plain = buildUserText('до епіцентру', NOW);
  const taught = buildUserText('до епіцентру', NOW, [{ phrase: 'епіцентр', placeId: 'malyn.tsentr' }]);
  assert.ok(!plain.includes('Місцеві назви'));
  assert.ok(taught.includes('- епіцентр → malyn.tsentr'));
  assert.ok(taught.indexOf('Місцеві назви') < taught.indexOf('<question>'));
  assert.ok(!buildSystemPrompt().includes('епіцентр'));
});
