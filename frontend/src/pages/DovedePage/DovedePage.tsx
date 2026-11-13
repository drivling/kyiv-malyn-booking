/**
 * «Доведе» — пошук своїми словами (Docs/dovede-roadmap.md). Фаза 1: розуміння в браузері, без ШІ; історії
 * будуються з розкладу сайту (/poputky/search), якорів і міського планувальника Малина. Бачить лише адмін
 * (AdminOnly в App.tsx), сторінка не в меню, не в sitemap, noindex.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { usePageSeo } from '@/hooks';
import { getKyivDateString, getKyivMinutesNow } from '@/pages/LocalTransportPage/kyivTime';
import { usePlannerModel } from '@/pages/LocalTransportPage/journey/usePlannerModel';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { classify, composeStories, corridorCities, resolveDate } from './compose/composeStories';
import { shareText } from './compose/narrate';
import type { ComposeOutcome, Story } from './compose/types';
import { addDays, parseLocal } from './nlu/parseLocal';
import type { KyivNow, LocalParse, TripIntent } from './nlu/types';
import { ChoiceCards, type Choice } from './ui/ChoiceCards';
import { dateHeading, placeRefLabel } from './ui/labels';
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
  | { kind: 'loading'; parse: LocalParse; now: KyivNow }
  | { kind: 'result'; parse: LocalParse; intent: TripIntent; outcome: ComposeOutcome; date: string; now: KyivNow; query: string }
  | { kind: 'error'; parse: LocalParse; now: KyivNow; message: string };

function kyivNow(): KyivNow {
  return { date: getKyivDateString(), mins: getKyivMinutesNow() };
}

export default function DovedePage() {
  usePageSeo({ title: 'Доведе', canonicalUrl: 'https://malin.kiev.ua/dovede', robots: 'noindex, nofollow' });
  const { ready, plannerFor } = usePlannerModel(DEFAULT_TRANSPORT_CITY);
  const [text, setText] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pending = useRef<{ q: string; override?: Partial<TripIntent> } | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const run = useCallback(
    async (q: string, override?: Partial<TripIntent>) => {
      const now = kyivNow();
      const parse = parseLocal(q, now);
      const intent: TripIntent = { ...parse.intent, ...override };
      const id = ++seq.current;
      setChosenId(null);
      setView({ kind: 'loading', parse, now });
      if (!ready) {
        pending.current = { q, override };
        return;
      }
      pending.current = null;
      const shape = classify(intent);
      const cities = corridorCities(shape);
      const schedulesFor = async (d: string) => (cities ? (await apiClient.searchPoputky({ from: cities.from, to: cities.to, date: d })).schedules : []);
      try {
        let date = resolveDate(intent.when.day, now);
        let outcome = composeStories({ intent, now, date, schedules: await schedulesFor(date), planner: plannerFor(date) }, shape);
        if (outcome.kind === 'empty' && date === now.date) {
          const tomorrow = addDays(now.date, 1);
          const next = composeStories(
            { intent: { ...intent, when: { day: 'tomorrow', kind: 'depart' } }, now, date: tomorrow, schedules: await schedulesFor(tomorrow), planner: plannerFor(tomorrow) },
            shape,
          );
          if (next.kind === 'stories') {
            outcome = { ...next, notice: 'Сьогодні вже нічого не їде — найближчі варіанти завтра.' };
            date = tomorrow;
          }
        }
        if (id !== seq.current) return;
        setView({ kind: 'result', parse, intent, outcome, date, now, query: q });
      } catch {
        if (id !== seq.current) return;
        setView({ kind: 'error', parse, now, message: 'Не вдалося отримати розклад. Перевірте мережу й спробуйте ще раз.' });
      }
    },
    [ready, plannerFor],
  );

  // Датасет міста ще вантажився, коли людина спитала, — відповідаємо, щойно він є
  useEffect(() => {
    if (ready && pending.current) {
      const { q, override } = pending.current;
      void run(q, override);
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
      <p className="dv-banner">Таємна сторінка: бачите лише ви. Відповідь складає розклад сайту; ШІ підключимо у фазі 2.</p>
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
        <div className="dv-field">
          <textarea
            id="dv-q"
            ref={inputRef}
            rows={2}
            value={text}
            placeholder="Звідки й куди їдете?"
            enterKeyHint="search"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(text);
              }
            }}
          />
          <button className="dv-go" type="submit">
            Знайти
          </button>
        </div>
        {view.kind !== 'idle' ? <Understanding parse={view.parse} now={view.now} /> : null}
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

      <section className="dv-out" aria-live="polite">
        {view.kind === 'loading' ? <Loading parse={view.parse} waitingForCity={!ready} /> : null}
        {view.kind === 'error' ? <Panel title="Щось пішло не так">{view.message}</Panel> : null}
        {view.kind === 'result' ? (
          <Result
            view={view}
            chosenId={chosenId}
            onChoose={setChosenId}
            stopName={stopName}
            onRetry={(override) => void run(view.query, override)}
            onExample={(q) => {
              setText(q);
              void run(q);
            }}
            onShare={(s) => void share(s, view.now)}
            onReset={() => {
              setText('');
              setView({ kind: 'idle' });
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </section>

      {toast ? (
        <div className="dv-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Loading({ parse, waitingForCity }: { parse: LocalParse; waitingForCity: boolean }) {
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
    case 'empty':
      return <Panel title="Рейсів не знайшов">На цю дату нічого не їде. Спробуйте інший день.</Panel>;
    case 'stories':
      break;
  }

  if (outcome.askMode && !chosenId) {
    return (
      <>
        <TripHead story={stories[0]} now={now} />
        {outcome.notice ? <p className="dv-notice">{outcome.notice}</p> : null}
        <ChoiceCards question="Як вам зручніше?" choices={modeChoices} hint="«маршруткою» чи «електричкою»" onChoose={onChoose} />
      </>
    );
  }
  const main = stories.find((s) => s.id === chosenId) ?? stories[0];
  const others = stories.filter((s) => s !== main);
  return (
    <>
      <TripHead story={main} now={now} />
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
              </button>
            );
          })}
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

function TripHead({ story, now }: { story: Story; now: KyivNow }) {
  return (
    <p className="dv-trip-head">
      <b>
        {story.fromLabel} → {story.toLabel}
      </b>
      <span>{dateHeading(story.date, now)}</span>
    </p>
  );
}
