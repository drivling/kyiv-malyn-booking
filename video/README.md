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
    // також: { frame, scrollBy: 400 }, { frame, run: async (page) => { … } }
  ],
};
```

## Оновити дані

```bash
npm run fixtures
```

Перезаписує `capture/fixtures/transport-dataset.json` і `poputky/*.json` з проду (лише публічні GET). Числа в
сценарії звірені зі знімком 2026-11-14 (датасет revision 2026-11-10T11:35Z) — після оновлення звірте їх знову.
Оголошення попуток із проду не зберігаються: їх підміняє `fixtures/rides.mjs` (вигадані імена, номер
`+380 00 123 45 67`, якого не може існувати).

## Монтаж

```bash
npm run studio        # Remotion Studio: перегляд, перемотка, пропси (showSafe — безпечні зони Reels)
npm run render:test   # out/studio-test.mp4 — перевірка студії, 5 с
npm run typecheck
```

Бренд-кит (`src/brand/`):
- `tokens.ts` — кадр 1080 × 1920 @ 30, кольори `--dv-*`, безпечні зони Meta (14 % / 35 % / 6 %);
- `beat.ts` — 125 BPM: `beats(n)`, `bars(n)`, `sec(s)` → номер кадру;
- `Logo` — «Доведе.» з крапкою: `still`, `drop` (падає й тричі підстрибує на біт), `pulse` («ви тут»), `blink`;
- `Caption` — титр-плашка у верхній безпечній зоні; `PhoneFrame` — нейтральний телефон без бренду;
- `Capture` — кадри зйомки (`from`, `rate`) і кружечки тапів; `dotIris` — склейка «через крапку»;
  `SafeZones` — підсвітка безпечних зон для Studio.
