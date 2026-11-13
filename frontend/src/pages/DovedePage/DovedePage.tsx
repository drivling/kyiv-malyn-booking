/**
 * «Доведе» — пошук своїми словами (Docs/dovede-roadmap.md). Розуміння: спершу словник у браузері; якщо він
 * упевнений — відповідаємо одразу, а Claude (POST /admin/dovede/understand, фаза 2) лише перевіряє й може
 * тихо запропонувати інше тлумачення; якщо ні — чекаємо Claude, а без нього лишаємось на місцевому розборі.
 * Історії будуються з розкладу сайту (/poputky/search), якорів і міського планувальника Малина — ШІ часу й
 * рейсів не називає. Бачить лише адмін (AdminOnly в App.tsx), сторінка не в меню, не в sitemap, noindex.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { usePageSeo } from '@/hooks';
import { getKyivDateString, getKyivMinutesNow } from '@/pages/LocalTransportPage/kyivTime';
import { usePlannerModel } from '@/pages/LocalTransportPage/journey/usePlannerModel';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { classify, composeStories, corridorCities, resolveDate } from './compose/composeStories';
import { clock, shareText } from './compose/narrate';
import type { ComposeOutcome, Story } from './compose/types';
import { localIsSure, pickIntent, sameAnswer, usableAiIntent, withIntent } from './nlu/merge';
import { addDays, parseLocal } from './nlu/parseLocal';
import { setStopPlaces } from './nlu/places';
import { buildStopPlaces } from './nlu/stopPlaces';
import type { KyivNow, LocalParse, TripIntent } from './nlu/types';
import { ChoiceCards, type Choice } from './ui/ChoiceCards';
import { QueryField, type QueryFieldHandle } from './ui/QueryField';
import { RouteCard } from './ui/RouteCard';
import { SlotSheet, type SlotKind } from './ui/SlotSheet';
import { TimeStrip } from './ui/TimeStrip';
import { DOVEDE_URL_KEYS, intentToParams, paramsToIntent } from './ui/url';
import { routeNo } from '@/utils/routeNames';
import { dateHeading, modeLabel, placeRefLabel, whenLabel } from './ui/labels';
import { storySummary } from './ui/format';
import { StoryView } from './ui/StoryView';
import { Understanding } from './ui/Understanding';
import './DovedePage.css';

const EXAMPLES = [
  'Як доїхати з Києва (Святошин) до Малина на вокзал',
  'з Царського села до Києва завтра зранку',
  'електричкою з Києва до Малина',
  'автобусом з Царського села на вокзал',
];

type View =
  | { kind: 'idle' }
  | { kind: 'loading'; parse: LocalParse; now: KyivNow; thinking?: boolean }
  | { kind: 'result'; parse: LocalParse; intent: TripIntent; outcome: ComposeOutcome; date: string; now: KyivNow; query: string }
  | { kind: 'error'; parse: LocalParse; now: KyivNow; message: string };

function kyivNow(): KyivNow {
  return { date: getKyivDateString(), mins: getKyivMinutesNow() };
}

export default function DovedePage() {
  usePageSeo({ title: 'Доведе', canonicalUrl: 'https://malin.kiev.ua/dovede', robots: 'noindex, nofollow' });
  const { ready, plannerFor, stops, routes } = usePlannerModel(DEFAULT_TRANSPORT_CITY);
  // Зупинки з розкладу стають місцями словника («Поворот на Коновальця»); список «поточний», як номери маршрутів
  const stopIndex = useMemo(() => {
    const index = buildStopPlaces(stops);
    setStopPlaces(index);
    return index;
  }, [stops]);
  const [text, setText] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Claude зрозумів питання інакше, ніж словник, за яким уже показано відповідь */
  const [suggestion, setSuggestion] = useState<TripIntent | null>(null);
  const pending = useRef<{ q: string; chosen?: TripIntent } | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<QueryFieldHandle>(null);
  const [sheet, setSheet] = useState<SlotKind | null>(null);
  // Після відповіді рядок «Розумію…» згортається «під кат» в один рядок-підсумок; розгортає сама людина
  const [slotsOpen, setSlotsOpen] = useState(false);
  // Номер відповіді: нова відповідь — блоки зʼявляються наново, один за одним
  const [answerNo, setAnswerNo] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlRead = useRef(false);

  /** Намір → розклад → історії */
  const answer = useCallback(
    async (id: number, q: string, parse: LocalParse, intent: TripIntent, now: KyivNow) => {
      const shape = classify(intent);
      const cities = corridorCities(shape);
      const schedulesFor = async (d: string) => (cities ? (await apiClient.searchPoputky({ from: cities.from, to: cities.to, date: d })).schedules : []);
      try {
        let date = resolveDate(intent.when.day, now);
        let outcome = composeStories({ intent, now, date, schedules: await schedulesFor(date), planner: plannerFor(date), routes }, shape);
        if (outcome.kind === 'empty' && date === now.date) {
          const tomorrow = addDays(now.date, 1);
          const next = composeStories(
            { intent: { ...intent, when: { day: 'tomorrow', kind: 'depart' } }, now, date: tomorrow, schedules: await schedulesFor(tomorrow), planner: plannerFor(tomorrow), routes },
            shape,
          );
          if (next.kind === 'stories') {
            outcome = { ...next, notice: 'Сьогодні вже нічого не їде — найближчі варіанти завтра.' };
            date = tomorrow;
          }
        }
        if (id !== seq.current) return;
        setView({ kind: 'result', parse, intent, outcome, date, now, query: q });
        setSlotsOpen(false);
        setAnswerNo((n) => n + 1);
        // Адреса відповіді — лише id місць, дата, час і транспорт; тексту питання в ній немає
        setSearchParams(intentToParams(intent, date), { replace: true });
      } catch {
        if (id !== seq.current) return;
        setView({ kind: 'error', parse, now, message: 'Не вдалося отримати розклад. Перевірте мережу й спробуйте ще раз.' });
      }
    },
    [plannerFor, setSearchParams, routes],
  );

  /** `chosen` — готовий намір (людина вибрала уточнення чи пропозицію): Claude тоді не питаємо */
  const run = useCallback(
    async (q: string, chosen?: TripIntent) => {
      const now = kyivNow();
      const parse = parseLocal(q, now, stopIndex, routes);
      const id = ++seq.current;
      setChosenId(null);
      setSuggestion(null);
      setView({ kind: 'loading', parse: chosen ? withIntent(parse, chosen) : parse, now });
      if (!ready) {
        pending.current = { q, chosen };
        return;
      }
      pending.current = null;
      if (chosen) {
        await answer(id, q, withIntent(parse, chosen), chosen, now);
        return;
      }
      if (localIsSure(parse)) {
        // Словник упевнений: відповідаємо одразу, Claude перевіряє у фоні (і пише в журнал порівняння)
        void apiClient.dovedeUnderstand(q, parse.intent).then((r) => {
          if (id !== seq.current || !r || !usableAiIntent(r.intent)) return;
          if (r.intent.confidence !== 'low' && !sameAnswer(parse.intent, r.intent)) setSuggestion(r.intent);
        });
        await answer(id, q, parse, parse.intent, now);
        return;
      }
      setView({ kind: 'loading', parse, now, thinking: true });
      const r = await apiClient.dovedeUnderstand(q, parse.intent);
      if (id !== seq.current) return;
      const intent = pickIntent(parse.intent, r?.intent);
      await answer(id, q, withIntent(parse, intent), intent, now);
    },
    [ready, answer, stopIndex, routes],
  );

  // Датасет міста ще вантажився, коли людина спитала, — відповідаємо, щойно він є
  useEffect(() => {
    if (ready && pending.current) {
      const { q, chosen } = pending.current;
      void run(q, chosen);
    }
  }, [ready, run]);

  const ask = (q: string) => {
    const t = q.trim();
    if (!t) {
      inputRef.current?.focus();
      return;
    }
    void run(t);
  };

  const stopName = useMemo(() => {
    const date = view.kind === 'result' ? view.date : kyivNow().date;
    const p = plannerFor(date);
    return (id: string) => p?.stopName(id) ?? id;
  }, [plannerFor, view]);

  // Посилання з id (`?f=&t=&d=…`) відкриває ту саму відповідь без тексту питання
  useEffect(() => {
    // зупинки з розкладу (`t=st_0071`) стають відомими лише з датасетом міста
    if (urlRead.current || !ready) return;
    urlRead.current = true;
    const fromUrl = paramsToIntent(searchParams, kyivNow());
    if (fromUrl) void run('', fromUrl);
  }, [searchParams, run, ready]);

  // Розбір під час набору: підсвічування в полі й рядок «Розумію…» ще до кнопки «Знайти»
  const live = useMemo(() => (text.trim() ? parseLocal(text, kyivNow(), stopIndex, routes) : null), [text, stopIndex, routes]);
  const answeredFor = view.kind === 'result' ? view.query : null;
  const textMatchesAnswer = answeredFor == null || text.trim() === answeredFor || (answeredFor === '' && !text.trim());
  const shown: { parse: LocalParse; now: KyivNow } | null =
    view.kind !== 'idle' && textMatchesAnswer ? { parse: view.parse, now: view.now } : live ? { parse: live, now: kyivNow() } : null;

  const collapsed = view.kind === 'result' && textMatchesAnswer && !slotsOpen;

  const pickSlot = (patch: Partial<TripIntent>) => {
    setSheet(null);
    if (!shown) return;
    void run(text.trim(), { ...shown.parse.intent, ...patch });
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const share = async (story: Story, now: KyivNow) => {
    const textToShare = shareText(story, stopName, `${story.fromLabel} → ${story.toLabel} · ${dateHeading(story.date, now)}`);
    try {
      await navigator.clipboard.writeText(textToShare);
      setToast('Скопійовано: можна вставити у Viber чи SMS.');
    } catch {
      setToast('Не вдалося скопіювати.');
    }
  };

  const answered = view.kind !== 'idle';

  return (
    <div className={`dv-page${answered ? ' dv-page--answered' : ''}`}>
      <p className="dv-banner">Таємна сторінка: бачите лише ви. Питання розуміє словник у браузері, складніші — Claude; час і рейси завжди з розкладу сайту.</p>
      <header className="dv-brand">
        <h1 className="dv-brand__name">
          Доведе<span>.</span>
        </h1>
        <p className="dv-brand__tag">Спитайте своїми словами — і доведе.</p>
      </header>

      <form
        className="dv-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <label htmlFor="dv-q" className="dv-sr-only">
          Куди вам потрібно доїхати?
        </label>
        <QueryField ref={inputRef} value={text} spans={live?.spans ?? []} onChange={setText} onSubmit={() => ask(text)} />
        {shown ? (
          <div className={`dv-cut${collapsed ? ' is-collapsed' : ''}`}>
            <div className="dv-cut__inner">
              <Understanding parse={shown.parse} now={shown.now} onEdit={setSheet} />
            </div>
          </div>
        ) : null}
        {view.kind === 'result' && textMatchesAnswer ? (
          <button type="button" className={`dv-summary${collapsed ? '' : ' is-open'}`} aria-expanded={!collapsed} onClick={() => setSlotsOpen((o) => !o)}>
            {collapsed ? (
              <>
                <span className="dv-summary__text">{summaryLabel(view.intent, view.date, view.now)}</span>
                <span className="dv-summary__act">змінити</span>
              </>
            ) : (
              <span className="dv-summary__act">згорнути</span>
            )}
            <span className="dv-summary__chev" aria-hidden="true" />
          </button>
        ) : null}
      </form>

      {view.kind === 'idle' ? (
        <section className="dv-home" aria-label="Приклади питань">
          <h2>Спитайте, наприклад</h2>
          <div className="dv-chips">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                className="dv-chip"
                onClick={() => {
                  setText(q);
                  void run(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* key: нова відповідь або інший варіант — блоки зʼявляються наново, один за одним (dv-out--in у CSS) */}
      <section className={`dv-out${view.kind === 'result' ? ' dv-out--in' : ''}`} aria-live="polite" key={view.kind === 'result' ? `${answerNo}-${chosenId ?? ''}` : 'wait'}>
        {view.kind === 'loading' ? <Loading parse={view.parse} waitingForCity={!ready} thinking={view.thinking === true} /> : null}
        {view.kind === 'error' ? <Panel title="Щось пішло не так">{view.message}</Panel> : null}
        {view.kind === 'result' && suggestion ? (
          <p className="dv-notice dv-suggest">
            <span>Можливо, ви мали на увазі: {intentLabel(suggestion, view.now)}?</span>
            <button type="button" className="dv-btn dv-btn--ghost" onClick={() => void run(view.query, suggestion)}>
              Показати
            </button>
          </p>
        ) : null}
        {view.kind === 'result' ? (
          <Result
            view={view}
            chosenId={chosenId}
            onChoose={setChosenId}
            stopName={stopName}
            onRetry={(override) => void run(view.query, { ...view.intent, ...override })}
            onExample={(q) => {
              setText(q);
              void run(q);
            }}
            onShare={(s) => void share(s, view.now)}
            onReset={() => {
              setText('');
              setView({ kind: 'idle' });
              setSuggestion(null);
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  DOVEDE_URL_KEYS.forEach((k) => next.delete(k));
                  return next;
                },
                { replace: true },
              );
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </section>

      {sheet && shown ? <SlotSheet slot={sheet} intent={shown.parse.intent} onPick={pickSlot} onClose={() => setSheet(null)} /> : null}

      {toast ? (
        <div className="dv-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/** «Київ · Святошин → Малин · вокзал · завтра» — намір одним рядком */
function intentLabel(intent: TripIntent, now: KyivNow): string {
  const from = placeRefLabel(intent.from);
  const to = placeRefLabel(intent.to);
  const places = from && to ? `${from} → ${to}` : to ? `до: ${to}` : from ? `з: ${from}` : '';
  return [places, whenLabel(intent.when, now).text].filter(Boolean).join(' · ');
}

/** Підсумок згорнутого «Розумію…»: «Малин · з-д «Прожектор» → Малин · Царське село · сьогодні, пʼятниця о 16:00» */
function summaryLabel(intent: TripIntent, date: string, now: KyivNow): string {
  const from = placeRefLabel(intent.from);
  const to = placeRefLabel(intent.to);
  const places = from && to ? `${from} → ${to}` : to ? `до: ${to}` : from ? `з: ${from}` : '';
  const time = intent.when.time ? `${intent.when.kind === 'arrive' ? 'до' : 'о'} ${intent.when.time}` : '';
  const mode = modeLabel(intent.modes, (intent.routes ?? []).map((id) => routeNo(id)));
  return [places, [dateHeading(date, now), time].filter(Boolean).join(' '), mode.guessed ? '' : mode.text].filter(Boolean).join(' · ');
}

function Loading({ parse, waitingForCity, thinking }: { parse: LocalParse; waitingForCity: boolean; thinking: boolean }) {
  if (thinking && !waitingForCity) {
    return (
      <div className="dv-status">
        <span className="dv-status__dot" aria-hidden="true" />
        <span>Розумію питання…</span>
      </div>
    );
  }
  const from = placeRefLabel(parse.intent.from);
  const to = placeRefLabel(parse.intent.to);
  const what = from && to ? `як дістатися: ${from} → ${to}` : to ? `як дістатися до: ${to}` : 'дорогу';
  return (
    <div className="dv-status">
      <span className="dv-status__dot" aria-hidden="true" />
      <span>
        Шукаю {what}…{waitingForCity ? ' (завантажую розклад міста)' : ''}
      </span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dv-panel">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

type ResultView = Extract<View, { kind: 'result' }>;

function Result({
  view,
  chosenId,
  onChoose,
  stopName,
  onRetry,
  onExample,
  onShare,
  onReset,
}: {
  view: ResultView;
  chosenId: string | null;
  onChoose: (id: string) => void;
  stopName: (id: string) => string;
  onRetry: (override: Partial<TripIntent>) => void;
  onExample: (q: string) => void;
  onShare: (s: Story) => void;
  onReset: () => void;
}) {
  const { outcome, now } = view;
  const chooseFrom = useCallback(
    (key: string) => onRetry({ from: key === 'kyiv' ? { id: 'city.Kyiv', text: 'Київ' } : { id: 'malyn.tsentr', text: 'центр' } }),
    [onRetry],
  );
  const askFromChoices = useMemo<Choice[]>(
    () => [
      { key: 'kyiv', title: 'З Києва', sub: 'маршрутка ≈ 1 год 30 хв, електричка ≈ 2 год' },
      { key: 'malyn', title: 'Містом, з центру Малина', sub: 'міський автобус' },
    ],
    [],
  );
  const stories = useMemo(() => (outcome.kind === 'stories' ? outcome.stories : []), [outcome]);
  const modeChoices = useMemo<Choice[]>(
    () =>
      stories.map((s) => {
        const sum = storySummary(s);
        return { key: s.id, title: sum.title, sub: sum.sub, time: sum.time, timeSub: 'на місці' };
      }),
    [stories],
  );

  switch (outcome.kind) {
    case 'ask_from':
      return <ChoiceCards question="Звідки вирушаєте?" choices={askFromChoices} hint="«з Києва»" onChoose={chooseFrom} />;
    case 'ask_to':
      return <Panel title="Куди їдемо?">Напишіть, звідки й куди, наприклад «з Малина до Києва завтра зранку».</Panel>;
    case 'unknown_place':
      return (
        <Panel title={`Не знаю, де це: «${outcome.words[0]}»`}>
          <p>Я знаю Київ, Малин і місця в Малині: вокзал, автостанцію, центр, лікарню, Царське село, Малинівку, Юрівку…</p>
          <p>Напишіть найближчу зупинку або район.</p>
        </Panel>
      );
    case 'outside':
      return (
        <Panel title="Цю дорогу я ще вчу">
          У першій версії «Доведе» знає дорогу Київ — Малин і міські автобуси Малина. Житомир, Коростень і попутки — далі.
        </Panel>
      );
    case 'poputka_soon':
      return (
        <Panel title="Попутки — згодом">
          <p>Поки підказую маршрутки й електрички.</p>
          <button type="button" className="dv-btn" onClick={() => onRetry({ modes: [] })}>
            Показати маршрутки й електрички
          </button>
        </Panel>
      );
    case 'not_trip':
      return (
        <Panel title="Я підказую дорогу">
          <p>Напишіть, звідки, куди й коли.</p>
          <div className="dv-chips">
            {EXAMPLES.slice(0, 2).map((q) => (
              <button key={q} type="button" className="dv-chip" onClick={() => onExample(q)}>
                {q}
              </button>
            ))}
          </div>
        </Panel>
      );
    case 'route_info':
      return (
        <>
          <RouteCard info={outcome} date={view.date} today={view.date === now.date} stopName={stopName} />
          <div className="dv-foot">
            <button type="button" className="dv-btn dv-btn--ghost" onClick={onReset}>
              Нове питання
            </button>
          </div>
        </>
      );
    case 'empty':
      return <Panel title="Рейсів не знайшов">На цю дату нічого не їде. Спробуйте інший день.</Panel>;
    case 'stories':
      break;
  }

  if (outcome.askMode && !chosenId) {
    return (
      <>
        {outcome.notice ? <p className="dv-notice">{outcome.notice}</p> : null}
        <ChoiceCards question="Як вам зручніше?" choices={modeChoices} hint="«маршруткою» чи «електричкою»" onChoose={onChoose} />
      </>
    );
  }
  const main = stories.find((s) => s.id === chosenId) ?? stories[0];
  const others = stories.filter((s) => s !== main);
  // одна шкала часу на всі варіанти: видно, хто раніше виїжджає і хто раніше на місці
  const scaleFrom = Math.min(...stories.map((s) => s.leaveMins));
  const scaleTo = Math.max(...stories.map((s) => s.arriveMins));
  return (
    <>
      {outcome.notice ? <p className="dv-notice">{outcome.notice}</p> : null}
      <p className="dv-lead">{main.lead}</p>
      <StoryView story={main} stopName={stopName} />
      {others.length ? (
        <section className="dv-alts" aria-label="Інші варіанти">
          <h3>Інші варіанти</h3>
          {others.map((s) => {
            const sum = storySummary(s);
            return (
              <button key={s.id} type="button" className="dv-alt" onClick={() => onChoose(s.id)}>
                <span>
                  <span className="dv-alt__title">{sum.title}</span>
                  <span className="dv-alt__sub">{sum.sub}</span>
                </span>
                <span className="dv-choice__time">{sum.time}</span>
                <TimeStrip story={s} from={scaleFrom} to={scaleTo} />
              </button>
            );
          })}
          <p className="dv-strip-scale" aria-hidden="true">
            <span>{clock(scaleFrom)}</span>
            <span>{clock(scaleTo)}</span>
          </p>
        </section>
      ) : null}
      <div className="dv-foot">
        <button type="button" className="dv-btn" onClick={() => onShare(main)}>
          Поділитися текстом
        </button>
        <button type="button" className="dv-btn dv-btn--ghost" onClick={onReset}>
          Нове питання
        </button>
      </div>
    </>
  );
}
