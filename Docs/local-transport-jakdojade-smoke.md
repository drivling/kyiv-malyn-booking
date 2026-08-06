# /transport smoke checklist (Jakdojade rebuild)

Date: 2026-08-06  
Branch: local commits only (no push)

## Checklist

- [ ] `/transport` loads without `/data/*.json` (Network: only `GET /transport/dataset`)
- [ ] З / До combobox + ⇄ + дата/час + «Знайти» → `/transport/:from/:to?d&h`
- [ ] Список лише connecting; час = наступне відправлення зі зупинки З; verified pill
- [ ] Карта: маркери з dataset; pick З/До; mobile sheet collapsed/mid/full + invalidateSize
- [ ] Geo «Найближча» використовує coords з dataset
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
- [ ] Empty after «Знайти» — honest copy (no «перегляньте всі маршрути нижче»); one empty-state; link to stop board OK
- [ ] With З + До → cards show **selected З → До**, departure time, line №, verified / line ends meta
- [ ] Click marker → **one** picker: bottom stop-sheet («Звідси» / «Сюди»); no radial overlay; no Leaflet popup actions
- [ ] Terms everywhere **З / До** (map strip / sheet / labels; no «ПО»)
- [ ] Geo button text «Найближча» (no emoji); date invalid → soft «Формат: ДД.ММ.РР»
- [ ] ⇄ in form and map strip stay in sync (swap З/До)

### Mobile (≤767, DevTools iPhone)

- [ ] Collapsed sheet does not cover last connection cards (`padding-bottom` on panel)
- [ ] Snap collapsed → mid → full; backdrop in mid/full; after open map tiles OK (`invalidateSize`)
- [ ] Marker tap → mid + stop-sheet only (no third competing UI)
- [ ] `lt-mobile-map-toggle` — light text on dark pill, readable contrast

### Do not break (this cycle)

- [ ] Detail `/transport/route/...` and tablica `/transport/stop` still work (planner-only + shared map/sheet CSS)
