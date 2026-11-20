"""
Логотип ТОВ «Технології» українською — `python3 scripts/teaser/lockup.py` (потрібні fonttools, brotli, uharfbuzz і
мережа до Google Fonts). Пише поруч два SVG, текст у них — кривими, тож шрифт на місці не потрібен:
- technologies-logo-uk.svg      — знак + «Технології» + «ТОВ» (дзеркало «Technologies / LLC» із сайту компанії);
- technologies-logo-uk-line.svg — знак + «ТОВ «Технології»» одним рядком, для дрібного розміру (підпис у роликах).
Знак — векторний, із сайту компанії (icon0.svg). «Technologies» там набрано Poppins SemiBold, а кирилиці в Poppins
нема, тому слово — Montserrat: найближчий геометричний гротеск із українськими літерами.
"""
import io, os, re, urllib.request
from fontTools.ttLib import TTFont
import uharfbuzz as hb

OUT = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=40).read()

def font_bytes(css, rng_hint):
    """Підмножина шрифту з Google Fonts (woff2 → sfnt) за початком її unicode-range"""
    for block in css.split('@font-face')[1:]:
        if rng_hint in block:
            f = TTFont(io.BytesIO(get(re.search(r'url\(([^)]+)\)', block).group(1)))); f.flavor = None
            buf = io.BytesIO(); f.save(buf); return buf.getvalue()
    raise SystemExit(f'немає підмножини {rng_hint}')

class PathPen:
    def __init__(s, sx, ox, oy): s.d = []; s.sx = sx; s.ox = ox; s.oy = oy
    def p(s, x, y): return f'{s.ox + x * s.sx:.2f} {s.oy - y * s.sx:.2f}'
    def move_to(s, x, y, *_): s.d.append('M' + s.p(x, y))
    def line_to(s, x, y, *_): s.d.append('L' + s.p(x, y))
    def quadratic_to(s, cx, cy, x, y, *_): s.d.append('Q' + s.p(cx, cy) + ' ' + s.p(x, y))
    def cubic_to(s, c1x, c1y, c2x, c2y, x, y, *_): s.d.append('C' + s.p(c1x, c1y) + ' ' + s.p(c2x, c2y) + ' ' + s.p(x, y))
    def close_path(s, *_): s.d.append('Z')

def runs(text, datas):
    """Текст → відрізки [(рядок, шрифт)]: підмножини Google Fonts (кирилиця / латиниця з лапками) — різні файли."""
    faces = [hb.Face(d) for d in datas]
    def pick(ch):
        for i, f in enumerate(faces):
            if hb.Font(f).get_nominal_glyph(ord(ch)): return i
        raise SystemExit(f'немає гліфа для «{ch}»')
    out = []
    for ch in text:
        i = 0 if ch == ' ' and not out else (out[-1][1] if ch == ' ' else pick(ch))
        if out and out[-1][1] == i: out[-1][0] += ch
        else: out.append([ch, i])
    return [(t, datas[i]) for t, i in out]

def outline(text, datas, wght, size, x, baseline, tracking=0.0):
    """→ (path d, ширина). tracking — в em."""
    d = ''; total = 0.0
    parts = runs(text, datas)
    for n, (t, data) in enumerate(parts):
        pd, w = outline_run(t, data, wght, size, x + total, baseline, tracking, last=(n == len(parts) - 1))
        d += pd; total += w
    return d, total

def outline_run(text, data, wght, size, x, baseline, tracking, last):
    face = hb.Face(data); font = hb.Font(face); font.set_variations({'wght': wght})
    upem = face.upem; sx = size / upem
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {'kern': True})
    pen = PathPen(sx, 0, baseline); cur = 0.0
    funcs = hb.DrawFuncs()
    funcs.set_move_to_func(lambda x_, y_, p: p.move_to(x_, y_))
    funcs.set_line_to_func(lambda x_, y_, p: p.line_to(x_, y_))
    funcs.set_quadratic_to_func(lambda a, b, c, d, p: p.quadratic_to(a, b, c, d))
    funcs.set_cubic_to_func(lambda a, b, c, d, e, f, p: p.cubic_to(a, b, c, d, e, f))
    funcs.set_close_path_func(lambda p: p.close_path())
    n = len(buf.glyph_infos)
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        if info.codepoint == 0: raise SystemExit(f'немає гліфа для «{text[info.cluster]}»')
        pen.ox = x + (cur + pos.x_offset) * sx
        font.draw_glyph(info.codepoint, funcs, pen)
        cur += pos.x_advance + (tracking * upem if (i < n - 1 or not last) else 0)
    return ''.join(pen.d), cur * sx

INK = '#00152E'; SUB = '#6D7B99'
MARK = '''<defs><linearGradient id="tb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1E5BFF"/><stop offset="1" stop-color="#0CD2FF"/></linearGradient><linearGradient id="ts" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82FF"/><stop offset="1" stop-color="#1240E0"/></linearGradient></defs>
<g transform="translate({tx} {ty}) scale({k})"><path d="M100 32H476Q494 32 484 46L440 116Q434 125 422 125H42Q22 125 32 110L86 41Q92 32 100 32Z" fill="url(#tb)"/><path d="M246 136H300Q316 136 312 152L254 398Q251 411 240 418L140 478Q120 490 120 467V214Q120 196 136 186L230 140Q238 136 246 136Z" fill="url(#ts)"/><path d="M120 340L304 186L254 398Q251 411 240 418L140 478Q120 490 120 467Z" fill="#0A2AA8" fill-opacity=".28"/></g>'''
# знак: у viewBox 512 займає x 26…490, y 32…485 → підганяємо під висоту 108
K = 108 / 453.0
def mark(tx=0.0, ty=0.0, k=K): return MARK.format(tx=f'{tx - 26 * k:.2f}', ty=f'{ty - 32 * k:.2f}', k=f'{k:.4f}')

css = get('https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap').decode()
mont = [font_bytes(css, 'U+0301'), font_bytes(css, 'U+0000-00FF')]  # кирилиця, латиниця (лапки)

# 1) головний: знак + «Технології» + «ТОВ» (дзеркало англійського «Technologies / LLC»)
SIZE = 46.0  # висота великої літери 32 — як у «Technologies» на сайті
word, w = outline('Технології', mont, 720, SIZE, 113, 60, -0.035)
sub, sw = outline('ТОВ', mont, 600, 13.0, 0, 87, 0.62)
right = 113 + w
sub, _ = outline('ТОВ', mont, 600, 13.0, right - sw - 1, 87, 0.62)
W = round(right + 3); H = 108
svg1 = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="ТОВ «Технології»">{mark()}<path d="{word}" fill="{INK}"/><path d="{sub}" fill="{SUB}"/></svg>\n'
open(f'{OUT}/technologies-logo-uk.svg', 'w').write(svg1)

# 2) рядок для дрібного розміру: знак + «ТОВ «Технології»»
h = 40.0; k2 = h / 453.0; size2 = 30.0; base = 30.5
t, tw = outline('ТОВ «Технології»', mont, 650, size2, h * 1.03 * (464 / 453) + 9, base, -0.01)
W2 = round(h * 1.03 * (464 / 453) + 9 + tw + 1)
svg2 = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W2} {int(h)}" width="{W2}" height="{int(h)}" role="img" aria-label="ТОВ «Технології»">{mark(0, 0, k2)}<path d="{t}" fill="{INK}"/></svg>\n'
open(f'{OUT}/technologies-logo-uk-line.svg', 'w').write(svg2)
print('uk', W, H, 'line', W2, int(h), 'word w %.1f' % w)
