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
