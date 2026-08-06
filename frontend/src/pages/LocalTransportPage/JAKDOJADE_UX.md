# UX Jakdojade — що відтворено та що ні

Оновлено: 2026-08-06 (rebuild `/transport` на Local + dataset API).

## Кольори (сайт, не wtk-red)

Плановий `wtk-red #E30613` **свідомо не повернуто**: публічний сайт уже на BBC cyan (`#00aff5` / текст `#054752`), і транспорт має виглядати як частина того самого продукту. Акцент, кнопки «Знайти», пілюлі ліній і tablica thead використовують `--lt-accent` = cyan сайту. Origin/destination: зелений `#0fa573` / cyan `#00aff5`.

## Відтворено максимально близько

### Головна (`/transport`, `/transport/З/До`)
- Поля «З» / «До», ⇄, дата ДД.ММ.РР, час, «Знайти».
- URL `/transport/From/To?d=&h=`.
- Список лише connecting-маршрутів; наступне відправлення зі зупинки «З»; verified pill.
- Desktop: ліва панель + карта; mobile: bottom sheet (collapsed / mid / full).
- Вибір зупинок з карти; geo «Найближча»; SubNav → табло.

### Деталь (`/transport/route/:id?...`)
- Бар назад + № лінії + З→До + дата/час.
- Перемикач напрямку з rematch зупинок за координатами.
- Tablica Відправлення | Прибуття (+ select як mobile fallback).
- Таймлайн зупинок із сегментів dataset; badges З/До; друк.

### Табло (`/transport/stop`, `/transport/stop/:id`)
- Countdown-картки, «весь день», deep-link у detail з `stop,dir,time,d,h`.
- Дані лише з `GET /transport/dataset`.

---

## Що не робили в цьому циклі

| Елемент | Причина |
|--------|--------|
| **wtk-red #E30613** | Пріоритет кольорів головної сторінки сайту. |
| **Режим «прибуття о»** | Out of scope. |
| **Пересадки / live GPS / embed** | Out of scope. |
| **Піксельна копія Jakdojade** | Немає живого референсу для вимірювань. |
