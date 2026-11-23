/**
 * «Доведе» — пошук своїми словами (Docs/dovede-roadmap.md). Розуміння: спершу словник у браузері; якщо він
 * упевнений — відповідаємо одразу, а Claude (POST /dovede/understand, фаза 2) лише перевіряє й може
 * тихо запропонувати інше тлумачення; якщо ні — чекаємо Claude, а без нього лишаємось на місцевому розборі.
 * Історії будуються з розкладу сайту (/poputky/search), якорів і міського планувальника Малина — ШІ часу й
 * рейсів не називає. Доступ (access.ts): поки DOVEDE_PUBLIC не ON — пароль запрошених у рядку питання або
 * токен адміна. Сторінка без шапки сайту (App.tsx), не в меню, не в sitemap, noindex.
 * Хто відкриває сторінку вперше, спершу дивиться ролик-вступ (intro/DovedeIntro.tsx) — ще до пароля; сторінка
 * монтується під ним, коли ролик скінчився, і відкривається крізь дірку в закомпостованому талоні.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { usePageSeo } from '@/hooks';
import { getKyivDateString, getKyivMinutesNow } from '@/pages/LocalTransportPage/kyivTime';
import { usePlannerModel } from '@/pages/LocalTransportPage/journey/usePlannerModel';
import {
  KOROSTEN,
  buildKorostenPlaces,
  asksInsideKorosten,
  combineCorridor,
  isKorostenQuestion,
  isMalynKorostenTrip,
  korostenShape,
  korostenStopByLabel,
  mentionsKorosten,
  mergeKorostenSpans,
  hasMalynOnlyPlace,
  mentionsOtherCity,
  namesKorostenAsEnd,
  remapForKorosten,
} from './korosten/korostenCity';
import { korostenSpot, loadKorostenStreets } from './korosten/korostenStreets';
import { korostenStopForName } from './korosten/korostenPlaces';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { useDovedeAccess } from './access';
import { useDovedeIcons } from './brandIcons';
import { DOVEDE_DESCRIPTION, DOVEDE_OG, DOVEDE_TITLE } from '../../../scripts/dovede-brand.mjs';
import { DovedeIntro, type IntroEvent } from './intro/DovedeIntro';
import { INTRO_NAME } from './intro/introMedia';
import { newViewId, trackAd } from '@/ads/adEvents';
import { introSeen } from './intro/introState';
import { cityAsks, classify, defaultCarMinutes, composeStories, corridorCities, resolveDate, rideDepartures, type DriveEstimate } from './compose/composeStories';
import { placesInNote, type NoteDir } from './nlu/notePlaces';
import { clock, shareText } from './compose/narrate';
import { cityAskKey, type CityRoute, type ComposeOutcome, type Story } from './compose/types';
import { localIsSure, pickIntent, sameAnswer, usableAiIntent, withHouses, withIntent } from './nlu/merge';
import { addDays, parseLocal } from './nlu/parseLocal';
import { setStopPlaces } from './nlu/places';
import { setSynonyms } from './nlu/synonyms';
import { loadPageData, pageDataReady } from './data/pageData';
import { pageExamples } from './data/examples';
import { buildStopPlaces } from './nlu/stopPlaces';
import type { KyivNow, LocalParse, TripIntent } from './nlu/types';
import { ChoiceCards, type Choice } from './ui/ChoiceCards';
import { QueryField, type QueryFieldHandle } from './ui/QueryField';
import { voiceAllowed } from './voice/useVoiceInput';
import { applyHere, needsHere } from './geo/applyHere';
import { freshHere, geoAllowed, locateError, locateNow } from './geo/locate';
import { HERE_DETAIL, herePlace } from './geo/here';
import type { Schedule, ViberListing } from '@/types';
import { ContactCard, PriceCard } from './ui/InfoCards';
import { PoputkyCard } from './ui/RideBoard';
import { RouteCard } from './ui/RouteCard';
import { SlotSheet, type SlotKind } from './ui/SlotSheet';
import { TimeStrip } from './ui/TimeStrip';
import { DOVEDE_URL_KEYS, intentToParams, paramsToIntent, questionForUrl, questionFromParams, recallQuestion, rememberQuestion } from './ui/url';
import { routeNo } from '@/utils/routeNames';
import { dateHeading, modeLabel, placeRefLabel, whenLabel } from './ui/labels';
import { storySummary } from './ui/format';
import { StoryView } from './ui/StoryView';
import { Understanding } from './ui/Understanding';
import './DovedePage.css';


type View =
  | { kind: 'idle' }
  | { kind: 'loading'; parse: LocalParse; now: KyivNow; thinking?: boolean }
  | { kind: 'result'; parse: LocalParse; intent: TripIntent; outcome: ComposeOutcome; date: string; now: KyivNow; query: string }
  | { kind: 'error'; parse: LocalParse; now: KyivNow; message: string };

function kyivNow(): KyivNow {
  return { date: getKyivDateString(), mins: getKyivMinutesNow() };
}

/** Питання, для якого місто сторінки вже вибрано за місцем людини: вдруге за місцем не перемикаємо (без петлі) */
let geoSwitchedFor: string | null = null;

export default function DovedePage() {
  // Назва, опис і картка посилання — як у статичному dist/dovede/index.html (scripts/dovede-brand.mjs)
  usePageSeo({
    title: DOVEDE_TITLE,
    canonicalUrl: 'https://malin.kiev.ua/dovede',
    robots: 'noindex, nofollow',
    description: DOVEDE_DESCRIPTION,
    ogImage: DOVEDE_OG,
  });
  useDovedeIcons();
  // Доступ перевіряється вже під час ролика — після нього пароль чи пошук готові без очікування
  const access = useDovedeAccess();
  // video — ролик, сторінки ще немає; ticket — ролик скінчився, сторінка під ним (недоступна); done — лише сторінка
  const [intro, setIntro] = useState<'video' | 'ticket' | 'done'>(() => (introSeen() ? 'done' : 'video'));
  const covered = intro !== 'done';
  // облік реклами: перегляд ролика-вступу й «відкрив сторінку з доступом» (хто — визначає сервер)
  const [viewId] = useState(newViewId);
  const onIntroEvent = (event: IntroEvent) => trackAd({ placement: 'dovede', event, viewId, video: INTRO_NAME });
  usePageSeenOnce(access.state === 'open' && !covered);
  // Розклад міста й пошук вантажаться лише після входу
  // Місто питань: Малин (рідне) чи Коростень (етап 1 — лише містом; korosten/korostenCity.ts). Інше місто — інший
  // планувальник, тому пошук створюється наново (key), а питання, з яким перемкнулись, він ставить сам
  const [cityParams, setCityParams] = useSearchParams();
  const [cityState, setCityState] = useState<{ city: string; carry: string | null }>(() => ({
    city: cityParams.get('c') === KOROSTEN ? KOROSTEN : DEFAULT_TRANSPORT_CITY,
    carry: null,
  }));
  const switchCity = (city: string, q: string) => {
    setCityParams(city === KOROSTEN ? { c: KOROSTEN } : {}, { replace: true });
    setCityState({ city, carry: q || null });
  };
  const page =
    access.state === 'open' ? (
      <DovedeSearch key={cityState.city} city={cityState.city} carry={cityState.carry} onCity={switchCity} focusOnMount={access.justLoggedIn} />
    ) : (
      <Lock checking={access.state === 'checking'} holdFocus={covered} error={access.error} busy={access.busy} onLogin={access.login} />
    );
  return (
    <>
      {intro === 'video' ? null : <PageUnder covered={covered}>{page}</PageUnder>}
      {covered ? <DovedeIntro onTicket={() => setIntro((s) => (s === 'video' ? 'ticket' : s))} onDone={() => setIntro('done')} onEvent={onIntroEvent} /> : null}
    </>
  );
}

/** Раз за сесію вкладки: людина з доступом (пароль запрошених, адмін, публічна сторінка) бачить саму сторінку */
const PAGE_SEEN_KEY = 'dovede-page-seen:v1';
function usePageSeenOnce(visible: boolean) {
  useEffect(() => {
    if (!visible) return;
    try {
      if (sessionStorage.getItem(PAGE_SEEN_KEY)) return;
      sessionStorage.setItem(PAGE_SEEN_KEY, '1');
    } catch {
      /* без sessionStorage — рахуємо кожне відкриття */
    }
    trackAd({ placement: 'dovede', event: 'page', viewId: newViewId() });
  }, [visible]);
}

/** Сторінка під вступом: поки її накриває ролик чи талон, вона недоступна — ні фокусу, ні читача екрана */
function PageUnder({ covered, children }: { covered: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.inert = covered;
    if (covered) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  }, [covered]);
  return <div ref={ref}>{children}</div>;
}

function Brand() {
  return (
    <header className="dv-brand">
      <h1 className="dv-brand__name">
        Доведе<span>.</span>
      </h1>
      <p className="dv-brand__tag">Спитайте своїми словами — і доведе.</p>
    </header>
  );
}

/** Пароль запрошених — у тому ж рядку, де потім буде питання; кнопка «Hasło» */
function Lock({
  checking,
  holdFocus = false,
  error,
  busy,
  onLogin,
}: {
  checking: boolean;
  /** Сторінку ще накриває ролик-вступ: фокус (і клавіатура телефона) — лише коли вона відкриється */
  holdFocus?: boolean;
  error: string | null;
  busy: boolean;
  onLogin: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!checking && !holdFocus) input.current?.focus();
  }, [checking, holdFocus]);
  useEffect(() => {
    // невірний пароль — поле порожнє й знову у фокусі
    if (error) {
      setPassword('');
      input.current?.focus();
    }
  }, [error]);

  return (
    <div className="dv-page">
      <Brand />
      {checking ? null : (
        <form
          className="dv-ask dv-lock"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password || busy) {
              input.current?.focus();
              return;
            }
            void onLogin(password);
          }}
        >
          <label htmlFor="dv-q" className="dv-sr-only">
            Пароль
          </label>
          <div className="dv-ask__field">
            <div className="dv-field">
              <div className="dv-input">
                <input
                  id="dv-q"
                  ref={input}
                  type="password"
                  value={password}
                  placeholder="Пароль"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'dv-lock-error' : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button className="dv-go" type="submit" disabled={busy}>
                Hasło
              </button>
            </div>
          </div>
          {error ? (
            <p id="dv-lock-error" className="dv-lock__error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

function DovedeSearch({
  focusOnMount = false,
  city = DEFAULT_TRANSPORT_CITY,
  carry = null,
  onCity,
}: {
  focusOnMount?: boolean;
  /** місто питань: Малин чи Коростень (лише поїздки містом) */
  city?: string;
  /** питання, з яким перемкнули місто, — ставимо й відповідаємо одразу */
  carry?: string | null;
  onCity?: (city: string, q: string) => void;
}) {
  const korosten = city === KOROSTEN;
  const { ready, plannerFor, stops, routes, fare } = usePlannerModel(city);
  // Коридор Малин ↔ Коростень (етап 3): датасет Коростеня вантажиться, щойно питання його назвало, і лишається
  // другим, «пасивним» планувальником — номери й кольори сторінки лишаються малинськими
  const [needKorosten, setNeedKorosten] = useState(false);
  const far = usePlannerModel(!korosten && needKorosten ? KOROSTEN : null, { passive: true });
  const farIndex = useMemo(() => buildKorostenPlaces(far.stops), [far.stops]);
  /** датасет Коростеня є або вже не прийде (помилка) — питання з Коростенем можна розбирати */
  const farSettled = far.ready || (needKorosten && !far.loading && far.error != null);
  // Зупинки з розкладу стають місцями словника («Поворот на Коновальця»); список «поточний», як номери маршрутів.
  // У Коростені — його зупинки й народні назви («Пашини», «Гастелло», «міськлікарня»)
  const stopIndex = useMemo(() => {
    const index = korosten ? buildKorostenPlaces(stops) : buildStopPlaces(stops);
    setStopPlaces(index);
    return index;
  }, [stops, korosten]);
  const [searchParams, setSearchParams] = useSearchParams();
  // Слова питання з посилання (чи з памʼяті вкладки) — у полі з першого кадру; відповідь будує ефект нижче.
  // Пошук монтується вже після перевірки доступу: слова, поставлені лише в ефекті, приходили б пізніше за відповідь
  // Синоніми з адмінки: приходять раз на відкриття сторінки; номер версії перезапускає розбір уже набраного
  const [taught, setTaught] = useState(0);
  useEffect(() => {
    let alive = true;
    // дані сторінки з адмінки (метро-замінник, години й тариф метро) — один раз на сторінку; відповідь їх дочекається
    void loadPageData(() => apiClient.dovedePageData()).then(() => {
      // приклади питань могли змінитись — показати нові
      if (alive) setTaught((n) => n + 1);
    });
    void apiClient.dovedeSynonyms().then((list) => {
      if (!alive) return;
      setSynonyms(list);
      setTaught((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [text, setText] = useState(() =>
    carry ?? (paramsToIntent(searchParams, kyivNow()) ? questionFromParams(searchParams) || recallQuestion(searchParams) : ''),
  );
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Claude зрозумів питання інакше, ніж словник, за яким уже показано відповідь */
  const [suggestion, setSuggestion] = useState<TripIntent | null>(null);
  const pending = useRef<{ q: string; chosen?: TripIntent } | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<QueryFieldHandle>(null);
  // Мікрофон — усім, кому відкрито «Доведе» (цей пошук монтується лише з доступом), де є Web Speech (Docs/dovede-voice-roadmap.md)
  const voiceOn = useMemo(() => voiceAllowed(), []);
  // «Звідки — де я зараз» (Docs/dovede-geo-roadmap.md, Г2): за тим самим правилом — де браузер уміє геолокацію
  const geoOn = useMemo(() => geoAllowed(), []);
  const [sheet, setSheet] = useState<SlotKind | null>(null);
  // Після відповіді рядок «Розумію…» згортається «під кат» в один рядок-підсумок; розгортає сама людина
  const [slotsOpen, setSlotsOpen] = useState(false);
  // Номер відповіді: нова відповідь — блоки зʼявляються наново, один за одним
  const [answerNo, setAnswerNo] = useState(0);
  const urlRead = useRef(false);

  // після пароля фокус лишається в тому ж рядку — тепер це рядок питання
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

  /** Намір → розклад → історії */
  const answer = useCallback(
    async (id: number, q: string, parse: LocalParse, asked: TripIntent, now: KyivNow) => {
      await pageDataReady();
      // «звідки» не названо — від місця людини (координати лишаються у вкладці, в адресу не йдуть)
      let intent = asked;
      if (geoOn && needsHere(asked)) {
        const fix = freshHere() ?? (await locateNow());
        if (id !== seq.current) return;
        const r = applyHere(asked, fix, { pageCity: korosten ? 'Korosten' : 'Malyn', isLocalKorosten: (w) => korostenSpot(w) != null });
        intent = r.intent;
        if (r.outcome.kind === 'far') setToast('Ви далеко від міст, які я знаю, — скажіть, звідки їдете.');
        else if (!fix && locateError() === 'denied') setToast('Без доступу до місця не знаю, звідки ви, — скажіть словами.');
      }
      // вулиці Коростеня — окремий шматок даних: потрібні в режимі Коростеня й для коридору Малин ↔ Коростень
      if (korosten || intent.from?.id === 'city.Korosten' || intent.to?.id === 'city.Korosten') await loadKorostenStreets();
      const shape = korosten ? korostenShape(intent) : classify(intent);
      const cities = corridorCities(shape);
      // один запит: розклад коридору й оголошення попуток на цей день
      const found = new Map<string, Promise<{ schedules: Schedule[]; listings: ViberListing[] }>>();
      const searchFor = (d: string) => {
        if (!found.has(d)) {
          found.set(d, cities ? apiClient.searchPoputky({ from: cities.from, to: cities.to, date: d }).then((r) => ({ schedules: r.schedules ?? [], listings: r.listings ?? [] })) : Promise.resolve({ schedules: [], listings: [] }));
        }
        return found.get(d)!;
      };
      const schedulesFor = async (d: string) => (await searchFor(d)).schedules;
      // Попутки серед варіантів: скільки авто їде при виїзді о цій годині (із заторами, а не відповів сервер — сталі 1 год 35 хв)
      const notePlaces = (note: string, dir: NoteDir) => placesInNote(note, stopIndex, dir);
      const driveFor0 = async (d: string, listings: ViberListing[], asked: TripIntent) => {
        const times = cities ? rideDepartures({ intent: asked, now, date: d, listings }, shape) : [];
        const got = times.length && cities ? await apiClient.dovedeDriveTime({ from: cities.from, to: cities.to, date: d, times }) : null;
        return (depMins: number): DriveEstimate => {
          const exact = got?.minutes[clock(depMins)];
          return exact ? { minutes: exact, traffic: got!.source === 'traffic' } : { minutes: got?.fixedMinutes ?? defaultCarMinutes(shape.kind === 'to_malyn' || shape.kind === 'from_malyn' ? shape.far : 'Kyiv'), traffic: false };
        };
      };
      const driveFor = (d: string, listings: ViberListing[]) => driveFor0(d, listings, intent);
      try {
        let date = resolveDate(intent.when.day, now);
        const listings = (await searchFor(date)).listings;
        // Дорогу містом (Київ, Житомир) до місця «словами» знає сервер: складаємо, питаємо, чого бракує, і складаємо ще раз
        const withCity = async (compose: (cityRoutes: ReadonlyMap<string, CityRoute | null>) => ComposeOutcome): Promise<ComposeOutcome> => {
          const known = new Map<string, CityRoute | null>();
          let out = compose(known);
          // з хвилинами міста найкращим може стати інший рейс, про який ще не питали, — тому до трьох кіл
          for (let round = 0; round < 3; round++) {
            const asks = cityAsks(out, known);
            if (!asks.length) break;
            const got = await Promise.all(asks.map((a) => apiClient.dovedeCityRoute(a)));
            asks.forEach((a, i) => known.set(cityAskKey(a), got[i]));
            out = compose(known);
          }
          return out;
        };
        const today = { schedules: await schedulesFor(date), driveMinutes: await driveFor(date, listings) };
        // Коростень у коридорі: місце словами → зупинка його датасету, шлях від / до вокзалу — його планувальником
        const farStop = (detail: string) => korostenStopByLabel(farIndex, detail);
        // людина в Коростені (`HERE_DETAIL`): коростенська частина — від її точки
        const farSpot = (words: string) => (words === HERE_DETAIL ? herePlace() ?? null : korostenSpot(words));
        // Коростень: зупинка з відповіді Google → наша; автобус до місця словами — наш планувальник (`ownCityLegs`)
        const koStops = korosten ? stops : far.stops;
        const googleStop = (name: string) => korostenStopForName(koStops, name);
        const farFor = (d: string) => ({ farPlanner: far.plannerFor(d), farStop, farSpot, googleStop });
        let outcome = await withCity((cityRoutes) => composeStories({ intent, now, date, schedules: today.schedules, planner: plannerFor(date), routes, listings, cityFare: fare, driveMinutes: today.driveMinutes, notePlaces, cityRoutes, ...farFor(date) }, shape));
        if (outcome.kind === 'empty' && date === now.date) {
          const tomorrow = addDays(now.date, 1);
          const next0: TripIntent = { ...intent, when: { day: 'tomorrow', kind: 'depart' } };
          const later = (await searchFor(tomorrow)).listings;
          const morrow = { schedules: await schedulesFor(tomorrow), driveMinutes: await driveFor0(tomorrow, later, next0) };
          const next = await withCity((cityRoutes) =>
            composeStories({ intent: next0, now, date: tomorrow, schedules: morrow.schedules, planner: plannerFor(tomorrow), routes, listings: later, driveMinutes: morrow.driveMinutes, notePlaces, cityRoutes, ...farFor(tomorrow) }, shape),
          );
          if (next.kind === 'stories') {
            outcome = { ...next, notice: 'Сьогодні вже нічого не їде — найближчі варіанти завтра.' };
            date = tomorrow;
          }
        }
        // сьогодні попуток уже немає — показуємо завтрашні й кажемо про це
        if (outcome.kind === 'poputky' && outcome.rides.length === 0 && date === now.date && intent.when.day === 'today') {
          const tomorrow = addDays(now.date, 1);
          const next = composeStories({ intent, now, date: tomorrow, schedules: [], planner: null, routes, listings: (await searchFor(tomorrow)).listings }, shape);
          if (next.kind === 'poputky' && next.rides.length) {
            outcome = { ...next, notice: 'На сьогодні оголошень немає — ось завтрашні.' };
            date = tomorrow;
          }
        }
        if (id !== seq.current) return;
        setView({ kind: 'result', parse, intent, outcome, date, now, query: q });
        setSlotsOpen(false);
        setAnswerNo((n) => n + 1);
        // Відповідь будується з id місць, дати, часу й транспорту; слова питання йдуть у посилання цілком —
        // перезавантаження й чуже відкриття показують ту саму фразу. Вкладка ще й памʼятає їх сама (запас)
        const params = intentToParams(intent, date);
        if (korosten) params.set('c', KOROSTEN);
        const words = questionForUrl(q);
        if (words) params.set('q', words);
        rememberQuestion(params, q);
        setSearchParams(params, { replace: true });
      } catch {
        if (id !== seq.current) return;
        setView({ kind: 'error', parse, now, message: 'Не вдалося отримати розклад. Перевірте мережу й спробуйте ще раз.' });
      }
    },
    [plannerFor, setSearchParams, routes, fare, stopIndex, stops, korosten, far, farIndex, geoOn],
  );

  /** `chosen` — готовий намір (людина вибрала уточнення чи пропозицію): Claude тоді не питаємо */
  const run = useCallback(
    async (q: string, chosen?: TripIntent) => {
      const now = kyivNow();
      const parse = parseLocal(q, now, stopIndex, routes);
      // Коростень у питанні на сторінці Малина: спершу датасет Коростеня (коридор чи перемикання вирішуємо з ним)
      const korostenEnd = (i?: TripIntent | null) => i?.from?.id === 'city.Korosten' || i?.to?.id === 'city.Korosten';
      // «звідки» не названо й місто не назване — де людина: від цього залежить і місто сторінки
      // («до вокзалу» в Коростені — вокзал Коростеня), і коридор від її точки в Коростені до Малина
      // «Малин», «Київ»… (`mentionsOtherCity`) чи «Коростень» у словах — місто назване, за місцем не вибираємо
      const namesCity = mentionsKorosten(q) || mentionsOtherCity(q);
      const fix = !chosen && geoOn && needsHere(parse.intent) ? freshHere() ?? (await locateNow()) : null;
      const geoKorosten = !korosten && fix?.city === 'Korosten';
      const wordsFar = !korosten && (chosen ? korostenEnd(chosen) : mentionsKorosten(q));
      const wantsFar = wordsFar || geoKorosten;
      if (wantsFar && !farSettled) {
        setNeedKorosten(true);
        ++seq.current;
        setView({ kind: 'loading', parse: chosen ? withIntent(parse, chosen) : parse, now });
        pending.current = { q, chosen };
        return;
      }
      // Поїздка Малин ↔ Коростень («з Паперової фабрики в Коростень до міськлікарні», «з Пашин до Паперової фабрики»):
      // два розбори — малинський і коростенський; відповідає Малин, без Claude
      const corridor = !chosen && wordsFar && !asksInsideKorosten(q, parse.intent) ? combineCorridor(parse.intent, parseLocal(q, now, farIndex).intent, farIndex) : null;
      // Питання про інше місто, ніж зараз на сторінці («з Пашин до ринку» в Малині) — перемикаємо місто й питаємо там.
      // Поїздка Малин ↔ Коростень — питання Малина, не міста Коростеня.
      // Місто сторінки за місцем людини, коли в питанні міста нема: у Коростені «до вокзалу» — питання Коростеня (але не
      // «до Пелікана» — таке місце є лише в Малині, це коридор від її точки); у Малині на сторінці Коростеня — навпаки.
      // Один раз на питання: слова можуть повернути назад, і тоді лишаємося.
      if (!chosen && !corridor && onCity && fix && !namesCity && geoSwitchedFor !== q) {
        const byPlace = !korosten ? (fix.city === 'Korosten' && !hasMalynOnlyPlace(parse.intent) ? KOROSTEN : null) : fix.city === 'Malyn' && !isKorostenQuestion(q) ? DEFAULT_TRANSPORT_CITY : null;
        if (byPlace) {
          geoSwitchedFor = q;
          onCity(byPlace, q);
          return;
        }
      }
      if (!chosen && !corridor && onCity) {
        // з Коростеня назад до Малина: назване інше місто, Коростень як кінець поїздки або місце, яке є лише в Малині
        // («з Царського села на вокзал» — без коростенських слів); окремої кнопки «до Малина» на сторінці нема
        const other = korosten
          ? mentionsOtherCity(q) || namesKorostenAsEnd(q) || (!mentionsKorosten(q) && hasMalynOnlyPlace(parse.intent))
            ? DEFAULT_TRANSPORT_CITY
            : null
          : isKorostenQuestion(q) && !isMalynKorostenTrip(q, parse.intent)
            ? KOROSTEN
            : null;
        if (other) {
          onCity(other, q);
          return;
        }
      }
      const id = ++seq.current;
      setChosenId(null);
      setSuggestion(null);
      const shown = chosen ?? corridor;
      setView({ kind: 'loading', parse: shown ? withIntent(parse, shown) : parse, now });
      if (!ready) {
        pending.current = { q, chosen };
        return;
      }
      pending.current = null;
      if (corridor) {
        await answer(id, q, withIntent(parse, corridor), corridor, now);
        return;
      }
      // Коростень (етап 2): словник Коростеня, а коли він не впевнений — Claude з промптом Коростеня. Будь-який
      // розбір проходить remapForKorosten: малинські id → коростенські або невідомі слова, «в Коростені» — не місце
      if (korosten) {
        if (chosen) {
          await answer(id, q, withIntent(parse, chosen), chosen, now);
          return;
        }
        const local = remapForKorosten(parse.intent, q);
        const fromAi = (ai: TripIntent | undefined | null) => (usableAiIntent(ai) ? remapForKorosten(ai, q) : null);
        if (localIsSure(parse)) {
          void apiClient.dovedeUnderstand(q, local, undefined, KOROSTEN).then((r) => {
            const ai = fromAi(r?.intent);
            if (id !== seq.current || !ai) return;
            if (ai.confidence !== 'low' && !sameAnswer(local, ai)) setSuggestion(ai);
          });
          await answer(id, q, withIntent(parse, local), local, now);
          return;
        }
        setView({ kind: 'loading', parse, now, thinking: true });
        const r = await apiClient.dovedeUnderstand(q, local, undefined, KOROSTEN);
        if (id !== seq.current) return;
        const intent = pickIntent(local, fromAi(r?.intent));
        await answer(id, q, withIntent(parse, intent), intent, now);
        return;
      }
      if (chosen) {
        await answer(id, q, withIntent(parse, chosen), chosen, now);
        return;
      }
      if (localIsSure(parse)) {
        // Словник упевнений: відповідаємо одразу, Claude перевіряє у фоні (і пише в журнал порівняння)
        void apiClient.dovedeUnderstand(q, parse.intent).then((r) => {
          if (id !== seq.current || !r || !usableAiIntent(r.intent)) return;
          const ai = withHouses(r.intent);
          if (ai.confidence !== 'low' && !sameAnswer(parse.intent, ai)) setSuggestion(ai);
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
    [ready, answer, stopIndex, routes, korosten, onCity, farSettled, farIndex, geoOn],
  );

  // Питання, з яким перемкнули місто: відповідаємо, щойно є розклад нового міста (run сам чекає на нього)
  useEffect(() => {
    if (carry) void run(carry);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- лише раз, при появі пошуку в новому місті
  }, []);

  // Датасет міста ще вантажився, коли людина спитала, — відповідаємо, щойно він є
  useEffect(() => {
    if (ready && pending.current) {
      const { q, chosen } = pending.current;
      void run(q, chosen);
    }
  }, [ready, farSettled, run]);

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
    if (!fromUrl) return;
    // слова питання — з посилання або з памʼяті цієї вкладки; відповідь усе одно з id, Claude не питаємо
    const words = questionFromParams(searchParams) || recallQuestion(searchParams);
    if (words) setText(words);
    // номера будинку серед id немає — беремо його зі слів питання
    const said = words ? parseLocal(words, kyivNow(), stopIndex, routes).intent : null;
    const house = (ref: TripIntent['from'], mine: TripIntent['from'] | undefined) => (ref && mine && mine.id.startsWith(`${ref.id}:`) ? { ...ref, id: mine.id } : ref);
    void run(words, { ...fromUrl, from: house(fromUrl.from, said?.from), to: house(fromUrl.to, said?.to) });
  }, [searchParams, run, ready, stopIndex, routes]);

  // Розбір під час набору: підсвічування в полі й рядок «Розумію…» ще до кнопки «Знайти»
  const live = useMemo(() => {
    if (!text.trim()) return null;
    const now = kyivNow();
    const own = parseLocal(text, now, stopIndex, routes);
    // Коростень на сторінці Малина: коростенські слова теж підсвічені, а «Розумію…» — уже поїздка коридором
    if (korosten || !farIndex.length || !mentionsKorosten(text)) return own;
    const far = parseLocal(text, now, farIndex);
    const corridor = asksInsideKorosten(text, own.intent) ? null : combineCorridor(own.intent, far.intent, farIndex);
    return { ...own, intent: corridor ?? own.intent, spans: mergeKorostenSpans(own.spans, far.spans) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `taught`: нові синоніми міняють розбір того самого тексту
  }, [text, stopIndex, routes, taught, korosten, farIndex]);
  // коростенські слова під час набору — датасет Коростеня вантажиться заздалегідь (і для підсвічування, і для відповіді)
  useEffect(() => {
    if (!korosten && mentionsKorosten(text)) setNeedKorosten(true);
  }, [text, korosten]);
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
      <Brand />

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
        <QueryField
          ref={inputRef}
          value={text}
          spans={live?.spans ?? []}
          onChange={setText}
          onSubmit={() => ask(text)}
          onVoice={voiceOn ? (t, final) => (setText(t), final ? ask(t) : undefined) : undefined}
          onVoiceStart={geoOn ? () => void locateNow() : undefined}
        />
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
            {pageExamples(korosten).map((q) => (
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
            korosten={korosten}
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
              rememberQuestion(new URLSearchParams(), '');
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
  const mode = modeLabel(intent.modes, (intent.routes ?? []).map((id) => routeNo(id)), (intent.avoidRoutes ?? []).map((id) => routeNo(id)));
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
  korosten = false,
  chosenId,
  onChoose,
  stopName,
  onRetry,
  onExample,
  onShare,
  onReset,
}: {
  view: ResultView;
  /** питання про Коростень: підказки й варіанти «звідки» — коростенські */
  korosten?: boolean;
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
    (key: string) =>
      onRetry({
        from:
          key === 'kyiv'
            ? { id: 'city.Kyiv', text: 'Київ' }
            : key === 'k-vokzal'
              ? { id: 'st_1001', text: 'вокзал' }
              : key === 'k-tsentr'
                ? { id: 'st_1003', text: 'центр' }
                : { id: 'malyn.tsentr', text: 'центр' },
      }),
    [onRetry],
  );
  const askFromChoices = useMemo<Choice[]>(
    () =>
      korosten
        ? [
            { key: 'k-vokzal', title: 'Від вокзалу', sub: 'міський автобус' },
            { key: 'k-tsentr', title: 'Від центру Коростеня', sub: 'міський автобус' },
          ]
        : [
            { key: 'kyiv', title: 'З Києва', sub: 'маршрутка ≈ 1 год 30 хв, електричка ≈ 2 год' },
            { key: 'malyn', title: 'Містом, з центру Малина', sub: 'міський автобус' },
          ],
    [korosten],
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
      return <ChoiceCards question="Звідки вирушаєте?" choices={askFromChoices} hint={korosten ? '«з Пашин»' : '«з Києва»'} onChoose={chooseFrom} />;
    case 'ask_to':
      return (
        <Panel title="Куди їдемо?">
          {korosten ? 'Напишіть, звідки й куди, наприклад «з Пашин до міськлікарні».' : 'Напишіть, звідки й куди, наприклад «з Малина до Києва завтра зранку».'}
        </Panel>
      );
    case 'unknown_place':
      return (
        <Panel title={`Не знаю, де це: «${outcome.words[0]}»`}>
          {korosten ? (
            <p>У Коростені я знаю зупинки міських автобусів і народні назви: вокзал, ринок, центр, Гастелло, Пашини, Грозине, Чолівку, міськлікарню…</p>
          ) : (
            <p>Я знаю Київ, Малин і місця в Малині: вокзал, автостанцію, центр, лікарню, Царське село, Малинівку, Юрівку…</p>
          )}
          <p>Напишіть найближчу зупинку або район.</p>
        </Panel>
      );
    case 'outside':
      return (
        <Panel title="Цю дорогу я ще вчу">
          «Доведе» знає дороги Київ — Малин, Житомир — Малин, Коростень — Малин і міські автобуси Малина та Коростеня. Інші
          напрямки — далі.
        </Panel>
      );
    case 'city_link':
      // сервер дороги містом не дав (місця не знайшов, туди нічого не ходить або вичерпано ліміт) — чесно кажемо й даємо карту
      return (
        <Panel title="Цієї дороги містом я ще не знаю">
          <p>
            {outcome.cityName}: {outcome.fromLabel} → {outcome.toLabel}.
          </p>
          <p>
            <a href={outcome.mapsUrl} target="_blank" rel="noopener noreferrer">
              Маршрут у Google Maps ↗
            </a>
          </p>
        </Panel>
      );
    case 'poputky':
      return (
        <>
          <PoputkyCard info={outcome} dateLabel={dateHeading(view.date, now)} />
          <div className="dv-foot">
            <button type="button" className="dv-btn dv-btn--ghost" onClick={() => onRetry({ modes: [] })}>
              Показати маршрутки й електрички
            </button>
            <button type="button" className="dv-btn dv-btn--ghost" onClick={onReset}>
              Нове питання
            </button>
          </div>
        </>
      );
    case 'price':
      return (
        <>
          <PriceCard lines={outcome.lines} />
          <div className="dv-foot">
            <button type="button" className="dv-btn dv-btn--ghost" onClick={onReset}>
              Нове питання
            </button>
          </div>
        </>
      );
    case 'contact':
      return (
        <>
          <ContactCard />
          <div className="dv-foot">
            <button type="button" className="dv-btn dv-btn--ghost" onClick={onReset}>
              Нове питання
            </button>
          </div>
        </>
      );
    case 'not_trip':
      return (
        <Panel title="Я підказую дорогу">
          <p>Напишіть, звідки, куди й коли.</p>
          <div className="dv-chips">
            {pageExamples().slice(0, 2).map((q) => (
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
      {outcome.rides ? (
        <p className="dv-rides-more">
          {stories.some((s) => s.mode === 'poputka') ? 'Час попуток приблизний: водій може виїхати пізніше. ' : ''}
          <Link to={outcome.rides.boardUrl}>{outcome.rides.more > 0 ? `Ще ${outcome.rides.more} на дошці попуток →` : 'Дошка попуток →'}</Link>
        </p>
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
