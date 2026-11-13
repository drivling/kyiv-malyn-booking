# «Доведе» — UX research (2026-11-13)

Research brief for the natural-language «як доїхати» page, done by a designer sub-agent with web search.
Visual tokens were taken from `frontend/src/pages/LocalTransportPage/LocalTransportPage.css` (Golos Text, `--lt-*`,
start green `#0fa573`, destination cyan `#00aff5`, text `#054752`) and route colours via `routeColorStyle`
(see `LocalTransportPage/JAKDOJADE_UX.md`).

## (A) Patterns

1. **Mozilla Ubiquity (2008–09).** A Firefox command line whose preview list changed with every keystroke, showing
   what the parser thought you meant. Its second parser tagged each word with a role. **Borrow:** a live "this is
   how I understood you" line, with the same kind of roles: з → звідки, до/в → куди, о/зранку → коли.
   [semantic roles](https://wiki.mozilla.org/Labs/Ubiquity/Parser_2/Semantic_Roles),
   [0.5 release](https://blog.mozilla.org/labs/2009/06/ubiquity-0-5-preview-release)
2. **Quicksilver / Enso.** Launchers that split a command into separate boxes (thing → action → target).
   **Borrow:** a fixed slot order Звідки → Куди → Коли → Як, where each slot can be fixed on its own.
   [manual](https://qsapp.com/manual/getting-started/concepts-and-terminology/),
   [Enso](https://signalvnoise.com/posts/228-humanized-enso)
3. **Todoist / Fantastical date recognition.** Words the app understood are highlighted inside the text as you
   type. Tapping a highlight, or pressing Backspace once, turns it back into plain text. **Borrow:** this exact
   highlight-and-undo behaviour. [Todoist help](https://todoist.com/help/articles/205989121),
   [Fantastical](https://macrumors.com/2011/05/17/fantastical-natural-language-calendar-app-for-mac-launches)
4. **Wolfram|Alpha "Assuming … Use … instead".** It answers using its best guess and puts the other readings in one
   quiet line. **Borrow:** «Розумію «зранку» як 06:00–10:00 · Змінити». [FAQ](https://www.wolframalpha.com/faqs/)
5. **Google "Showing results for / Search instead for".** Google fixes the typo automatically but always offers a
   way back to what you typed. **Borrow:** fix misspelled places silently, with a "go back to what I typed" link.
   [overview](https://www.jcchouinard.com/google-escape-hatch/)
6. **Google Instant (2010), dropped in 2017.** Full results while typing were removed because on phones the
   keyboard covers half the screen. Autocomplete stayed. **Borrow:** while typing, update only the understanding
   line and the suggestions, never the answer.
   [launch](https://www.technologyreview.com/2010/09/20/200356/why-google-went-instant/),
   [removal](https://www.engadget.com/2017/07/26/google-drops-instant-search-unify-mobile-and-desktop/)
7. **Mad Libs forms (Luke Wroblewski, 2010).** Form fields written as blanks inside a sentence. One vendor test
   reported a 25–40% rise in completions, but another test
   [lost 22%](https://kalzumeus.com/2010/02/27/lesson-from-madlibs-signup-fad-do-your-own-tests). **Borrow:** the
   understanding line is a sentence you can edit, and it must still read naturally once filled.
   [summary](https://searchengineland.com/using-natural-language-to-improve-conversion-rates-41632)
8. **NS one-field journey planner (2014).** The Dutch railway tested a single box: «overmorgen om 11 uur van
   Enschede naar Utrecht» was split into the ordinary form fields. This is closest to our case. **Borrow:** turn
   the parsed request into our existing `/transport` planner URL, so the classic form doubles as the fallback and
   the way to check the answer. [Treinreiziger](https://www.treinreiziger.nl/ns-test-vereenvoudigde-reisplanner-met-1-zoekveld/)
9. **Gmail search chips (2020).** Filter buttons under the search box instead of typed operators. **Borrow:**
   Як/Коли chips under the field. [Workspace blog](https://workspaceupdates.googleblog.com/2020/02/gmail-search-chips-ga.html)
10. **SBB Touch Timetable.** The Swiss railway app shows tiles of favourite stations; you drag from one to another
    to get trains. **Borrow:** an empty state with place tiles where two taps make a query.
    [overview](https://www.myswissalps.com/timetable)
11. **NN/g chatbot study + Telegram reply keyboards.** People expect buttons for common answers but still need free
    text. In Telegram, tapping a button sends its label as if typed. **Borrow:** numbered cards that behave exactly
    like typing "1" or «електричкою». [NN/g](https://www.nngroup.com/articles/chatbots/),
    [Bot API](https://core.telegram.org/constructor/replyKeyboardMarkup)
12. **GOV.UK "one thing per page".** One question at a time lowers mental load, which matters most for older users.
    **Borrow:** ask at most one clarifying question, never a chain of them.
    [pattern](https://design-system.service.gov.uk/patterns/question-pages)
13. **Google Now "time to leave" cards; Transit / Citymapper GO.** Short commands with a countdown, such as "Get off
    in 2 stops". **Borrow:** each card headline is an instruction plus a time.
    [Transit GO](https://help.transitapp.com/article/549-how-to-use-go),
    [Citymapper GO](https://citymapper.com/i/517/go-your-personal-trip-assistant)
14. **Hipmunk timeline (closed 2020).** Flights drawn as coloured bars on one time axis, so options compare at a
    glance. **Borrow:** a mini time bar on each collapsed alternative.
    [MIT TR](https://www.technologyreview.com/2011/04/13/195793/travel-search-without-the-agony/amp/)
15. **Loading research.** Evidence on skeleton screens is mixed; they only help when they match the real layout.
    Waits of 1–10 s need visible feedback. **Borrow:** a status line built from the parsed words, not a generic
    spinner. [Nielsen](https://www.uxtigers.com/post/progress-indicators)

## (B) Design proposal

**Empty state**
- On phones the field sits about 35% down the screen: a 56 px auto-growing text area, 18 px Golos, radius 16, and a
  «Підкажіть →» button.
- A small wordmark above it, with one line: «Спитайте, як доїхати, — своїми словами».
- The placeholder is static: «Напр.: з Києва до Малина завтра зранку». Rotating examples only on desktop, never
  under reduced motion, and not announced to screen readers.
- Below the field: 3 tappable example chips («До Києва зараз», «Електричкою в Коростень», «Автобус до вокзалу»);
  recent queries stored on the device; a row of place tiles (Київ, Житомир, Коростень, Малин-вокзал) — two taps
  make a query.

**Typing state (all local, no network)**
- A local word list covers towns, stops, scheme hubs, Russian and surzhyk aliases (Святошино, електрічка, с утра)
  and time words (після обіду, завтра).
- Recognised words get a soft tint inside the field via a mirror layer: green for start, cyan for destination, a
  light route colour for transport type, pale yellow for time. Tapping a tint, or one Backspace, removes it.
- Under the field, the understanding line: `з [Київ, Святошин] до [Малин, вокзал] · [сьогодні] · [будь-яким
  транспортом]`. Dashed underline means guessed, solid means confirmed.
- Suggestions complete the current slot, not the whole sentence. Up to 4 rows, each with a type icon
  (місто/зупинка/станція) and a grey hint, e.g. «Царське Село — мікрорайон Малина». Arrow keys and Enter work, and
  picking a row turns it into a recognised word.

**Submit + loading (1–3 s)**
- The field slides to the top; the user's text stays.
- One polite live status line built from the parsed parts: «Шукаю, як дістатися з Києва (Святошин) до Малина…».
- Slots turn from dashed to solid as the model confirms them, and one skeleton story matching the real card layout
  appears.
- If the local parse already has both places, start the data query at the same time as the model call.
- After 4 s: «Ще мить — перевіряю електрички».

**Clarification state**
- Only ask when the transport type is missing and more than one type actually serves this pair. Otherwise just
  answer.
- Question: «Як вам зручніше?», then numbered cards that already contain the answer:
  **1 · Маршрутка** — 07:40 → 09:30, 120 ₴; **2 · Електричка** — 08:15 → 10:25; **3 · Попутка** — 2 оголошення.
- Keys 1/2/3 work when the text field is not focused; typing «1» or «маршруткою» in the field works too.
- Tapping a card opens that story right there. Never ask a second question.

**Result state (a story)**
- A lead sentence: «Найзручніше — маршрутка о 07:40, у Малині будете о 09:42».
- Then a vertical rail in the colour of each leg, times on the left:
  - **Intercity card:** transport icon and label, big time, «Сідайте тут: …» with the exact boarding spot, arrival
    time, duration, price. One small primary action: «Забронювати», or «Квиток» with an external-link icon for
    trains. Chips for «Інші рейси: 08:20 · 09:10».
  - **Transfer:** not a card, a dotted rail with one line: «Вийдіть на «Автостанції» · 12 хв на пересадку».
  - **City bus card:** route badge in its scheme colour, «№ 3 о 09:42», «Автостанція → Вокзал · 6 зупинок · 11 хв».
    Tapping opens `/transport/route/:id?stop&to&time`.
  - **Walk:** a thin dotted segment: «Пройдіть 300 м пішки (≈4 хв)», with a «Карта» link.
  - **End point:** «Вокзал, Малин · 09:55».
- Footer: «Поділитися» copies a plain-text version in the style of old printed «як доїхати» directions (good for
  Viber), plus «Інший час» and «Назад додому».
- Alternatives: up to 3 stories. The first is open; the others collapse to one line with a Hipmunk-style mini time
  bar.
- Desktop: a 640 px story column with an optional map on the right.

**Error states (calm wording, never red alarms)**
- **Unknown place:** wavy underline on the word, «Не знаю «Ковалівка». Можливо: [Ковалі] [Ковалівка (Малинський
  р-н)]?», plus «Показати на карті».
- **No trips today:** «Сьогодні маршруток уже немає; перша завтра о 05:50», plus the alternative type of transport,
  plus «Попутки на цей вечір / Додати запит».
- **Too late for city buses:** the bus card becomes «Міські автобуси вже не ходять (останній о 20:15) · пішки 2,1 км
  ≈ 25 хв».
- **Outside our area:** list the towns we know.
- **Model down:** answer from the local parse; if a slot is still missing, open the classic planner with the known
  fields filled in.

**Correcting a misunderstanding**
- Every slot in the understanding line is a button. On phones it opens a bottom sheet, on desktop a popover, with
  alternatives: places (all stops in that town, e.g. Святошин, Видубичі, Либідська); times (Зараз / Сьогодні о… /
  Завтра зранку); transport type.
- Editing a slot re-runs only the data query (instant, no model call).
- The «Розумію … · Змінити» line sits under the lead sentence.
- «Це не те» puts focus back in the field with the text kept.
- Sync the query to the URL so Back works and answers can be shared. Make this optional, because queries may
  contain home addresses.

**Accessibility**
- 18 px base text, 48 px touch targets, AA contrast.
- Slot meaning is never colour alone: there are always the words «з/до» and icons.
- Highlights are hidden from screen readers; the understanding line is the real labelled text.
- Status updates use polite live announcements; no time limits; reduced motion is respected.
- 24-hour times; polite «ви» throughout.
- Russian input is accepted, but answers are always in Ukrainian.
- The keyboard microphone works in the text area for voice input.
- Admin-only for now, so log queries the parser could not understand to grow the word list.

## (C) Names

1. **«Доведе»** — from the proverb «Язик до Києва доведе» ([ZN.ua](https://zn.ua/ukr/SOCIUM/yazik_do_kieva_dovede_a_v_kievi.html)):
   ask and you will get there. Literally fits a Kyiv–Malyn route; «Спитайте — доведе» works as the tagline.
   **Top pick — chosen by the owner.**
2. **«Дороговказ»** (signpost) — instantly clear, calm, well suited to older users.
3. **«Чумак»** — the folk figure of the long-distance traveller who knew every road.
4. **«Бувалий»** — "someone who has been everywhere"; warm and folksy.
5. **«Провідник»** (guide) — also means train conductor, a nice double meaning, though slightly ambiguous.
6. **«Вістовий»** — the Cossack messenger who brings word quickly; a sibling to «Джура».
7. **«Гонець»** — a courier; short, and suggests speed.
8. **«Чумацький шлях»** (the Ukrainian name for the Milky Way) — poetic, but long.
9. **«Спитай Джуру»** — builds on the owner's existing bot brand, but could be confused with his personal secretary.

Suggested placement: «Як доїхати · Доведе», with «Доведе» as the name of the search box within the existing app.
