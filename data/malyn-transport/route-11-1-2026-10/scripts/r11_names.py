"""Фаза 3: назва №11 як на листку. Кінцеві (fromName / toName) — назви зупинок і ключі для сайту, їх не чіпаємо;
повна назва з листка — в описі (scheme), номер 11/1 — у примітці (note). Показ «№11/1» на сайті — окреме
рішення власника (id маршруту — ключ у посиланнях, «/» у ньому ламає адреси й CSS-змінні схеми)."""
import sys

from r11_lib import apply_change

SCHEME = 'Паперова фабрика – Барміна – Вокзал ч/з Прожектор і в зворотному напрямку'
NOTE = ('Маршрут №11/1 (так на листку розкладу). Розклад — з листка 10.10.2026 (фото власника): туди Паперова '
        'фабрика → Барміна → Вокзал, назад Вокзал → Паперова фабрика → Барміна.')


def build(d):
    r = next(r for r in d['routes'] if r['id'] == '11')
    assert r['fromName'] == 'Паперова фабрика' and r['toName'] == 'Залізничний вокзал', (r['fromName'], r['toName'])
    r['scheme'], r['note'] = SCHEME, NOTE
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('r11-3', build, set(), {'11'}, dry=dry)
    a = next(r for r in cur['routes'] if r['id'] == '11'); b = next(r for r in nxt['routes'] if r['id'] == '11')
    for k in ('fromName', 'toName', 'scheme', 'note'):
        print(f'{k}: {a[k]!r}' + ('' if a[k] == b[k] else f'\n   → {b[k]!r}'))
