# Тизер «Доведе.» — відео

Код ролика з [плану](../Docs/dovede-teaser/roadmap.md) і [сценарію](../Docs/dovede-teaser/script.md). Пакет окремий:
не деплоїться, не входить у `npm test`, CI і husky.

| Тека | Що там |
|---|---|
| `capture/` | покадрова зйомка справжнього фронтенду (Playwright) |
| `capture/fixtures/` | знімок публічних даних з проду + вигадані попутки — усе, що бачить сторінка під час зйомки |
| `capture/scenes/` | сцени зйомки, по файлу на сцену |
| `src/brand/` | бренд-кит Remotion: кольори, сітка біта, шрифт, логотип, титри, телефон, кадри зйомки, склейка «через крапку» |
| `src/scenes/` | композиції Remotion |
| `public/captures/` | кадри зйомки (не в git — перезнімаються командою) |
| `out/` | рендери (не в git) |

## Встановити

```bash
cd video && npm ci
```

Remotion 4.0.539 (ліцензія безкоштовна для компаній до 3 працівників — у ТОВ двоє), Playwright 1.62.1 — той самий
Chromium, що в e2e фронтенду. Remotion має свій ffmpeg; системний (`brew install ffmpeg`) — для перегляду й нарізок.
Фронтенд має бути встановлений (`frontend/node_modules`): зйомка запускає його `vite`.

## Зняти сцену

```bash
npm run capture -- rides             # уся сцена → public/captures/rides/
npm run capture -- rides --frames 30 # перші 30 кадрів — швидка перевірка
```

Як це працює (`capture/run.mjs`):
- піднімає `vite` фронтенду на :4188 з `VITE_API_URL=http://localhost:4189`; бекенду немає — кожен запит до :4189
  перехоплює Playwright і віддає фікстуру. Невідомий запит друкується як `? немає фікстури` — додайте її в `api()`;
- телефон 390 × 844, DPR 3 → кадр 1170 × 2532, JPEG 92;
- час іде кадр за кадром (30 fps): `page.clock` керує Date, таймерами й requestAnimationFrame, а CSS-анімації й
  переходи стоять на паузі, і `currentTime` кожної ставиться під віртуальний час. Тож кадр N завжди однаковий;
- `manifest.json` поруч із кадрами: fps, розмір, кількість кадрів, тапи (де й коли «палець» торкнувся екрана).

Сцена — `capture/scenes/<назва>.mjs`:

```js
export default {
  name: 'rides',
  url: '/dovede',
  now: '2026-11-16T05:40:00Z',                 // годинник сторінки (понеділок 07:40 за Києвом)
  ready: { label: 'Куди вам потрібно доїхати?' }, // чекаємо цей елемент перед кадром 0
  frames: 165,
  actions: [
    { frame: 0, type: { label: '…', text: 'попутка з Києва в Малин', cps: 26 } }, // набір, знаків за секунду
    { frame: 30, press: 'Enter' },
    { frame: 84, tap: { role: 'button', name: /Відірвати номер/, nth: 0, atX: 0.3 } },
    // плавна прокрутка за 36 кадрів: верх елемента — на 20 % висоти екрана
    { frame: 232, scrollTo: { text: 'Вийдіть біля ПТЛ', align: 0.2, frames: 36 } },
    // також: { frame, scrollBy: 400 }, { frame, run: async (page) => { … } }
  ],
  stills: [{ name: 'full', fullPage: true }], // після останнього кадру: full.jpg — уся сторінка
};
```

У `manifest.json` ще `scroll` (прокрутка сторінки в кожному кадрі, CSS px) і `stills` (розміри знімків).
Сцена може мати `css` (стиль лише на час зйомки) і `prepare(page)` (код у сторінці перед кадром 0) — так у
`hero` сховано тимчасову плашку «лише телефоном» і кнопка квитка — «Забронювати»; сайт від цього не змінюється.
Зйомки зараз: `hero` (C і D, 360 кадрів), `rides` (E, 190), `city` (F1, 110), `board` (F4, 80).

Перед першим рендером: `npm run capture -- hero` (і `rides`, `city`, `board`), `npm run assets` (схеми й фото
наклейки в `public/assets/`), `npm run metronome` (для чернеток).

## Оновити дані

```bash
npm run fixtures
```

Перезаписує `capture/fixtures/transport-dataset.json` і `poputky/*.json` з проду (лише публічні GET). Числа в
сценарії звірені зі знімком 2026-11-14 (датасет revision 2026-11-10T11:35Z) — після оновлення звірте їх знову.
Оголошення попуток із проду не зберігаються: їх підміняє `fixtures/rides.mjs` (вигадані імена, номер
`+380 00 123 45 67`, якого не може існувати).

## Звук

```bash
npm run sound                          # public/audio/sfx/*.wav (28 звуків) + temp-125.wav — усе згенеровано кодом
npm run analyze -- public/audio/track.mp3 [--drop 10.4]   # темп, фаза, start для src/audio/music.ts
npm run master -- out/teaser.mp4       # → out/teaser-final.mp4: −14 LUFS, пік ≈ −1,5 dBTP, AAC 48 кГц
```

- Музика — `src/audio/music.ts`: `file`, `bpm`, `start` (секунда треку в кадрі 0). Сітка ролика (`brand/beat.ts`)
  бере темп звідти: інший темп — інші кадри склейок, ролик довшає чи коротшає сам (112 бітів).
- Дроп треку має лягти на початок B2 — 20-й біт ролика (0:09,6 при 125 BPM). `analyze` рахує `start` саме так;
  секунду дропу краще почути самому й передати `--drop` (автоматично — найсильніший сплеск 5–25 с).
- Звуки подій — `src/teaser/sounds.ts` (кадр, звук, гучність) для кожного кадру; синтез — `scripts/sound.mjs`.
- Пропси композицій: `sound` (музика й звуки, типово увімкнено), `click` (метроном поверх — перевірити біт).
- Справжній трек: згенерувати на платному тарифі (комерційні права), покласти в `public/audio/`, `npm run analyze`,
  вписати `bpm`/`start`/`file` і `temp: false`, `npm run render:teaser`, `npm run master -- out/teaser.mp4`.

## Монтаж

```bash
npm run studio            # Remotion Studio: перегляд, перемотка, пропси (showSafe, click)
npm run metronome         # public/audio/metronome-125.wav — клік замість музики для чернеток
npm run render:teaser     # out/teaser.mp4 — майстер 53,76 с, 1080 × 1920
npm run render:teaser15   # out/teaser-15.mp4 — версія 15 с
npm run render:draft -- --props='{"showSafe":false,"click":true,"shots":["B1","B2","C1"]}' --output=out/draft-b.mp4
npm run render:test       # out/studio-test.mp4 — перевірка студії, 5 с
npm run typecheck
```

Хід ролика — `src/teaser/timeline.ts` (кадри з `script.md`, тривалості в бітах; `MASTER` — 112 бітів, `SHORT` —
32). Кожен кадр починається на своєму біті; склейка `in: 'iris'` («через крапку») стартує рівно на біті вхідного
кадру. Готові кадри — у `src/teaser/shots/<розділ>.tsx` і в `READY` у `ShotsPlayer.tsx`; решта показується
заглушкою, тож майстер рендериться цілим завжди. Титри кадрів (`caption` у таймлайні) малює `ShotsPlayer`.
`Draft` — кілька кадрів поспіль із тривалостями майстра (чернетка 810 × 1440 для перегляду на телефоні).

Бренд-кит (`src/brand/`):
- `tokens.ts` — кадр 1080 × 1920 @ 30, кольори `--dv-*`, безпечні зони Meta (14 % / 35 % / 6 %);
- `beat.ts` — 125 BPM: `beats(n)`, `bars(n)`, `sec(s)` → номер кадру;
- `Logo` — «Доведе.» з крапкою: `still`, `drop` (падає й тричі підстрибує на біт), `pulse` («ви тут»), `blink`;
- `Caption` — титр-плашка у верхній безпечній зоні; `PhoneFrame` — нейтральний телефон без бренду;
- `Capture` — кадри зйомки (`from`, `rate`) і кружечки тапів; `dotIris` — склейка «через крапку»;
  `SafeZones` — підсвітка безпечних зон для Studio;
- камера: `PhoneFrame zoom={{ scale, x, y, shiftY }}` — наїзд на точку екрана й зсув телефона вгору (щоб важливе
  було вище нижніх 35 %); `FILL_ZOOM` — екран рівно на весь кадр (звідти склейка в `FullBleed`); `FullBleed` — кадр
  зйомки на всю ширину без рамки з тим самим `zoom`; `ease()` (`camera.ts`) — плавні рухи між кадрами.
