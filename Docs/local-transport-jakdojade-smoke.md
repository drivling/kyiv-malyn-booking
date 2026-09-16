# /transport smoke checklist (Jakdojade rebuild)

Date: 2026-08-06  
Branch: local commits only (no push)

## Checklist

- [ ] `/transport` loads without `/data/*.json` (Network: only `GET /transport/dataset`)
- [ ] З / До combobox + ⇅ + дата/час → `/transport/:from/:to?d&h` оновлюється сам; «Знайти» лише push + скрол до результатів
- [ ] Список лише connecting; час = наступне відправлення зі зупинки З; verified pill
- [ ] Карта: маркери з dataset; pick З/До; mobile sheet collapsed/mid/full + invalidateSize
- [ ] Geo «Поруч зі мною» використовує coords з dataset; вибір зупинки → «З» + фокус на «До»
- [ ] Detail: бар, напрямок rematch, tablica Відправлення|Прибуття, таймлайн, друк
- [ ] `/transport/stop/:id` countdown + «весь день» + link з `stop,dir,time,d,h`
- [ ] SubNav Маршрути ↔ Зупинка зберігає `d`/`h`
- [ ] QR `/transport/route/...?stop&dir` без `time` → nearest trip
- [ ] `/localtransport/...` редіректить на `/transport/...`
- [ ] Admin Map Editor save/reload + OSRM recalculate still works
- [ ] Theme: site cyan accents (not orphaned red-only tokens)

## Automated

```bash
cd frontend && npm test && npx tsc --noEmit
cd ../backend && npm test
```

## Regression notes (this commit)

- Confirmed no remaining `frontend/src` fetches to `/data/*` or imports of `segmentDurations.json`.
- Thin TransportPage UI removed; public shell is LocalTransport under `/transport*`.

---

## Planner UX v2 (З → До)

Date: 2026-08-07  
Goal: Jakdojade-like hierarchy — form → connection cards → map as stop picker only.

### Desktop (≥768)

- [ ] `/transport` — sticky form is calm (light chrome); results, not the form, draw the eye
- [ ] Without З/До — markers are dim/smaller; map stays Malyn center (~zoom 13), not fitBounds on all city stops
- [ ] Empty state — honest copy (no «перегляньте всі маршрути нижче»); one empty-state; link to stop board OK; on mobile «Відкрити карту» opens the sheet
- [ ] With З + До → h1 and tab title show the pair; cards show departure at «З», `№ → кінцева`, `HH:MM → HH:MM · N хв`, «через N хв» only for today, next-day wrap label; no «лінія …» / «перевірено» text
- [ ] Typing in «З» with «До» set → hint «Оберіть зупинку зі списку», previous cards stay, no «немає прямого маршруту»; backspace to empty keeps «До» and URL; «×» → `/transport?to=…`
- [ ] Click marker → **one** picker: bottom stop-sheet («Звідси» / «Сюди»); no radial overlay; no Leaflet popup actions
- [ ] Terms everywhere **З / До** (map strip / sheet / labels; no «ПО»)
- [ ] Geo button text «Поруч зі мною» (no emoji), error announced via `role="status"`; date/time collapsed to «Сьогодні, 09:12 · Змінити» — the panel opens a native date picker, time and chips «Зараз» / «Завтра» (d=, and h= for «Зараз»)
- [ ] No direct route → «Поруч є зупинки з прямим маршрутом» with up to 3 neighbours (≤400 m); click applies the pair and the URL follows
- [ ] ⇅ in form and map strip stay in sync (swap З/До) and the URL follows the swap

### Mobile (≤767, DevTools iPhone)

- [ ] Collapsed sheet does not cover last connection cards (`padding-bottom` on panel)
- [ ] Snap collapsed → mid → full; backdrop in mid/full; after open map tiles OK (`invalidateSize`)
- [ ] Marker tap → mid + stop-sheet only (no third competing UI)
- [ ] `lt-mobile-map-toggle` — light text on dark pill, readable contrast

### Stop board `/transport/stop`, `/transport/stop/:id` (iteration 3)

- [ ] Direct hit `/transport/stop/st_…` — field shows the stop name on the first frame (no raw id), h1 «Зупинка «…»», SubNav «Маршрути (З → До)» carries `?from=`
- [ ] Typing garbage in «Зупинка» — URL, h1, title and the departures stay; hint «Оберіть зупинку зі списку»; picking from the list → `/transport/stop/<id>?d&h` (replace); «×» → `/transport/stop?d&h`; keyboard-clearing navigates nowhere
- [ ] Card → route page → «Назад до пошуку» returns to the same stop's board; planner opened from the board (`?from=`) keeps `from=` current after picking another «З»
- [ ] «Поруч зі мною» under the field → list of nearest stops → tap opens that stop's board; denied permission announced via `role="status"`
- [ ] Date/time collapsed to «Сьогодні, 07:00 · Змінити»; «Завтра» / native date / time apply at once (URL `d=`/`h=` follows, no «Застосувати»)
- [ ] Desktop map shows all city stops (dim), selected one highlighted; marker tap opens that stop's board. Mobile (≤767): no map strip at the bottom, no dead padding under the list

### Site header (iteration 3)

- [ ] 390px: the top menu is one row (<60px): «Міжміські · Транспорт · Про нас · Допомога» scroll horizontally with a fade on the right while there is more; «Логін» / profile / «Вийти» are 40px icons with `aria-label`; «Транспорт» without the city ≤480px
- [ ] Desktop: unchanged (words, 60px); `/transport`, `/admin`, `/login`, booking page heights follow `--app-nav-height` (no gap or scrollbar under the header at 768–900px)

### Do not break (this cycle)

- [ ] Detail `/transport/route/...` and tablica `/transport/stop` still work (planner-only + shared map/sheet CSS)
