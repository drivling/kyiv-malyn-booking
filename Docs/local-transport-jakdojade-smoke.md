# /transport smoke checklist (Jakdojade rebuild → UX 2026-10)

Date: 2026-08-06, updated 2026-10 (see `frontend/src/pages/LocalTransportPage/JAKDOJADE_UX.md`, «UX 2026-10»)  
Branch: local commits only (no push)

## Checklist

- [ ] `/transport` loads without `/data/*.json` (Network: only `GET /transport/dataset`)
- [ ] «Звідки» / «Куди» combobox + ⇅ + чіпи дати/часу → `/transport/:from/:to?d&h` оновлюється сам; кнопки «Знайти» немає, нова пара прокручує до результатів
- [ ] Список лише connecting; час = наступне відправлення зі зупинки З; verified pill
- [ ] Карта: лінії всіх перевірених маршрутів у кольорах схеми, вузли підписані; тап по зупинці → одна картка «Звідси / Сюди / Табло»; телефон — чіп «Карта» → повноекранний overlay → «Готово»
- [ ] Geo — іконка-приціл у порожньому полі «Звідки» (coords з dataset); вибір зупинки → «Звідки» + фокус на «Куди»
- [ ] Detail: два тапи по таймлайну → «Звідки»/«Куди» в URL, стрічка відправлень (найближчий натиснутий), «Повний розклад» (десктоп — відкрито, телефон — згорнуто, друк — завжди), напрямок rematch + найближчий рейс
- [ ] `/transport/stop/:id` картки «через N хв» + чіп «Весь день» + чіпи ліній `?line=` + link з `stop,dir,time,d,h`
- [ ] SubNav Маршрути ↔ Зупинка зберігає `d`/`h`
- [ ] QR `/transport/route/...?stop&dir` без `time` → nearest trip
- [ ] `/localtransport/...` редіректить на `/transport/...`
- [ ] Admin Map Editor save/reload + OSRM recalculate still works (rename flow: see «Admin map editor: stop rename» below)
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
- [ ] Empty state = quick start: «Куди їдете?» with scheme-node chips (first tap sets «Куди», next «Звідки»), «Поруч зі мною», the whole scheme; on mobile «Відкрити карту» opens the overlay
- [ ] With З + До → h1 and tab title show the pair; cards show departure at «З», `№ → кінцева`, `HH:MM → HH:MM · N хв`, «через N хв» only for today, next-day wrap label; no «лінія …» / «перевірено» text
- [ ] Typing in «З» with «До» set → hint «Оберіть зупинку зі списку», previous cards stay, no «немає прямого маршруту»; backspace to empty keeps «До» and URL; «×» → `/transport?to=…`
- [ ] Click marker → **one** picker: the stop card over the map («Звідси» / «Сюди» / «Табло»); no radial overlay; no Leaflet popup actions
- [ ] Terms everywhere **Звідки / Куди** (field labels are markers with hidden text; badges on the timeline; map strip keeps the short «З: … / До: …»; no «ПО»)
- [ ] Geo icon in the empty «Звідки» field (aria-label «Знайти найближчі зупинки за геолокацією»), error announced via `role="status"`; date/time as chips «Зараз» / «Завтра» / «Сьогодні о 09:12» (the last one opens native date and time inputs; d=, and h= for «Зараз»)
- [ ] No direct route → «Поруч є зупинки з прямим маршрутом» with up to 3 neighbours (≤400 m); click applies the pair and the URL follows
- [ ] ⇅ in form and map strip stay in sync (swap З/До) and the URL follows the swap

### Mobile (≤767, DevTools iPhone)

- [ ] No map column on the phone; the «Карта» chip in the search card opens a full-screen overlay (`role="dialog"`), tiles OK after open (`invalidateSize`), «Готово»/Escape closes and focus returns to the chip
- [ ] Marker tap in the overlay → the stop card only (no third competing UI); «Звідси»/«Сюди» fill the pair, the results stay visible under the overlay

### Stop board `/transport/stop`, `/transport/stop/:id` (iteration 3)

- [ ] Direct hit `/transport/stop/st_…` — field shows the stop name on the first frame (no raw id), h1 «Зупинка «…»», SubNav «Маршрути (З → До)» carries `?from=`
- [ ] Typing garbage in «Зупинка» — URL, h1, title and the departures stay; hint «Оберіть зупинку зі списку»; picking from the list → `/transport/stop/<id>?d&h` (replace); «×» → `/transport/stop?d&h`; keyboard-clearing navigates nowhere
- [ ] Card → route page → «Назад до пошуку» returns to the same stop's board; planner opened from the board (`?from=`) keeps `from=` current after picking another «З»
- [ ] «Поруч зі мною» chip in the chips row → list of nearest stops → tap opens that stop's board; denied permission announced via `role="status"`
- [ ] Date/time chips «Зараз» / «Завтра» / «Сьогодні о 07:00»; «Завтра» / native date / time apply at once (URL `d=`/`h=` follows, no «Застосувати»); «Весь день» chip shows departures from 00:00; a line chip under the title filters the cards and writes `?line=`; sections: departures → mini scheme → «Про зупинку» → FAQ
- [ ] Desktop map shows all city stops (dim), selected one highlighted; marker tap opens that stop's board. Mobile (≤767): no map strip at the bottom, no dead padding under the list

### Site header (iteration 3)

- [ ] 390px: the top menu is one row (<60px): «Міжміські · Транспорт · Про нас · Допомога» scroll horizontally with a fade on the right while there is more; «Логін» / profile / «Вийти» are 40px icons with `aria-label`; «Транспорт» without the city ≤480px
- [ ] Desktop: unchanged (words, 60px); `/transport`, `/admin`, `/login`, booking page heights follow `--app-nav-height` (no gap or scrollbar under the header at 768–900px)

### Do not break (this cycle)

- [ ] Detail `/transport/route/...` and the stop board `/transport/stop` still work (shared tokens, chips and map CSS)

## Admin map editor: stop rename (2026-09-16)

`/admin/map-editor`, desktop (≥900px, the panel sits to the right of the map).

- [ ] Click a marker → its row is highlighted (`aria-current`), scrolled into view inside the panel only (page does not jump); the marker turns amber and sits above others. Click a row → the map pans to the stop; a marker click does not pan
- [ ] Search «Пошук зупинки» filters by name or `st_…`, the title shows «N з M»; ↑/↓ move the selection, Enter opens editing, Esc clears the query
- [ ] ✎ (or Enter on the selected row) turns the name into an input: Enter/✓ applies, Esc/✕ cancels, clicking elsewhere applies a changed valid name. Empty → «Назва не може бути порожньою»; an existing name (any case, extra spaces) → «Така назва вже є: … (st_…)»; >80 chars → «Назва задовга»; the row stays in edit mode
- [ ] Renamed row: «не збережено», «було: …», «↶» restores the db name, the line «Також оновиться при збереженні: кінцева №…, … рейсів» lists exact matches only (e.g. renaming «Лікарня» does not touch «Лікарня (Лісотехнікум)»); stops with `frontend/src/content/stops/<id>.ts` show the SEO-article note
- [ ] «Зберегти в базу · N змін» counts renames + moved markers + new technical stops + order/map_only changes, is disabled at 0; the confirm lists them and the propagation; closing the browser tab with changes asks for confirmation
- [ ] After save: status line, counter back to 0, `/transport` cards show «→ <new name>», `/transport/stop/<id>` shows the new name, route direction buttons show the new terminus; reload the «Розклад маршрутів» tab (it keeps its own copy of the dataset)
- [ ] Save error (backend down) → red alert above the map, the editor and unsaved changes stay
- [ ] «Редактор напрямку»: rows are selectable/renamable there too, «Порядок…» opens the order modal, the modal has no name field
- [ ] Marker drag still moves the stop (and selects it); MapBounds refits only when the mode or route changes
