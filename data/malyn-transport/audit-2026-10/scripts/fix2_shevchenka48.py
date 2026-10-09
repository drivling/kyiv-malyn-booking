"""Фаза 2 виправлень: нова зупинка «Шевченка 48» (st_0119) — «Сонечко» з файлу 2024.
«м-н Сонечко» st_0052 лишається на 10-ї ОГШБ. №3/7/10/12 проходять обидві: нову додаємо «назад»
між «Шевченка 22» і «ЗОШ 3 (навпроти)» (правий бік). №2/№5 — у фазі 3. 10-old — прихований, без змін."""
import sys

from apply_lib import apply_change, chain, insert_after, recalc, set_chains

NEW = {'id': 'st_0119', 'name': 'Шевченка 48', 'lat': 50.770398, 'lng': 29.232992}  # 11 м від буд. 48, парний бік
ROUTES = ['3', '7', '10', '12']


def build(d):
    assert not any(s['id'] == NEW['id'] or s['name'] == NEW['name'] for s in d['stops']), 'вже є'
    d['stops'].append(dict(NEW))
    for rid in ROUTES:
        t, b = chain(d, rid, 'orderThere'), chain(d, rid, 'orderBack')
        i = b.index('st_0098')
        assert b[i + 1] == 'st_0023', f'№{rid}: після «Шевченка 22» очікувалась «ЗОШ 3 (навпроти)», а не {b[i + 1]}'
        set_chains(d, rid, t, insert_after(b, NEW['id'], 'st_0098'))
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    apply_change('fix2', build, {NEW['id']}, set(ROUTES), dry=dry)
    if not dry:
        recalc('fix2', ['3', '7', '10'])  # у №12 сегментів немає
