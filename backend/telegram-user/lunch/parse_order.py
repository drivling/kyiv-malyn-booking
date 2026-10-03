"""Парсинг тексту замовлення → позиції меню + сума."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional, Sequence

from .db import MenuItemRow, OrderLineInput
from .util import normalize_dish_name, split_order_parts


@dataclass
class MatchedPart:
    raw: str
    item: Optional[MenuItemRow]
    score: float
    # Кілька страв підходять майже однаково — не вгадуємо, а просимо уточнити.
    alternatives: list[str] = field(default_factory=list)


@dataclass
class OrderParseResult:
    lines: list[OrderLineInput]
    total_uah: int
    matched: list[MatchedPart]
    unmatched: list[str]
    unavailable: list[str] = field(default_factory=list)
    # фрагмент замовлення → назви страв-кандидатів (підмножина unmatched)
    ambiguous: dict[str, list[str]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return len(self.lines) > 0 and len(self.unmatched) == 0 and len(self.unavailable) == 0

    @property
    def unmatched_text(self) -> str:
        return "; ".join(self.unmatched)


# Назви категорій, а не страв: саме слово «салат» не робить два різні салати схожими.
GENERIC_TOKENS = frozenset({"салат", "суп"})
# Якщо два кандидати відрізняються менш ніж на стільки — це неоднозначність, а не «перший у меню».
AMBIGUITY_MARGIN = 0.06
_NO_MATCH_SCORE = 0.30
_FUZZY_TOKEN_RATIO = 0.84
_SYNONYM_EXACT_SCORE = 0.995


def _token_set(s: str) -> set[str]:
    return {t for t in s.split() if len(t) > 1}


def _fold(t: str) -> str:
    """Лише для порівняння слів: укр/рос «и/і/ы» та «е/э» не мають розрізнятись."""
    return t.replace("і", "и").replace("ы", "и").replace("э", "е").replace("ї", "и")


# Збіг «за основою слова» (закінчення, описка) слабший за точний збіг слова: «курка» ≈ «курки»,
# але «Курка відварена» має виграти у «Філе курки з ананасом».
_STEM_MATCH_WEIGHT = 0.75


def _token_match_weight(a: str, b: str) -> float:
    """1.0 — те саме слово (з точністю до и/і/ы/э), 0.75 — те саме слово з іншим закінченням
    або опискою, 0 — різні слова."""
    fa, fb = _fold(a), _fold(b)
    if fa == fb:
        return 1.0
    shorter, longer = (fa, fb) if len(fa) <= len(fb) else (fb, fa)
    if len(shorter) >= 3 and longer.startswith(shorter):
        return _STEM_MATCH_WEIGHT
    if len(shorter) == 4 and fa[:3] == fb[:3]:
        # короткі слова з іншим закінченням: «шуба» / «шубою», «фета» / «фетою», «яйці» / «яйцем»
        return _STEM_MATCH_WEIGHT
    if len(shorter) >= 5:
        common = 0
        for ca, cb in zip(fa, fb):
            if ca != cb:
                break
            common += 1
        if common >= max(4, len(shorter) - 2):
            return _STEM_MATCH_WEIGHT
        if SequenceMatcher(None, fa, fb).ratio() >= _FUZZY_TOKEN_RATIO:
            return _STEM_MATCH_WEIGHT
    return 0.0


def _overlap(ta: set[str], tb: set[str]) -> tuple[int, float]:
    """(скільки слів з ta мають пару в tb, їх сумарна вага). Кожне слово tb — не більше одного разу."""
    free = list(tb)
    hits = 0
    weight = 0.0
    for x in sorted(ta):
        best_i, best_w = -1, 0.0
        for i, y in enumerate(free):
            w = _token_match_weight(x, y)
            if w > best_w:
                best_i, best_w = i, w
        if best_i >= 0:
            hits += 1
            weight += best_w
            del free[best_i]
    return hits, weight


def _similarity(a: str, b: str) -> float:
    """Score 0..1: containment + overlap токенів, але лише за значущими словами.

    Слово-категорія («салат», «суп») саме по собі збігом не є: «салат оливʼє» не дорівнює
    «салат грецький» тільки тому, що обидва — салати. Якщо в обох назвах є значущі слова,
    а спільного серед них немає (або менше 60% меншого набору) — це різні страви.
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = _token_set(a), _token_set(b)
    da, db = ta - GENERIC_TOKENS, tb - GENERIC_TOKENS
    shared_distinct = _overlap(da, db)[0] if (da and db) else None
    if shared_distinct == 0:
        return _NO_MATCH_SCORE
    if a in b or b in a:
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        # Запит (a) містить назву/синонім (b) і ще 2+ своїх значущих слова — це вже інша страва або кілька:
        # «філе» ⊂ «філе курки з помідором», «борщ» ⊂ «немає зеленого борща і вареників з картоплею».
        query_has_more = longer is a and shared_distinct is not None and len(da) - shared_distinct >= 2
        if not query_has_more:
            return 0.72 + 0.28 * (len(shorter) / max(len(longer), 1))
    if not ta or not tb:
        return 0.0
    if shared_distinct is not None:
        if shared_distinct < math.ceil(0.6 * min(len(da), len(db))):
            return _NO_MATCH_SCORE
        # У кожної назви є своє значуще слово, якого немає в іншій, і спільного менше 3/4 запиту —
        # це інший варіант страви: «філе курки з помідором» ≠ «Філе курки «Пікантне»».
        if shared_distinct < len(da) and shared_distinct < len(db) and shared_distinct < 0.75 * len(da):
            return _NO_MATCH_SCORE
    _hits, inter = _overlap(ta, tb)
    union = len(ta) + len(tb) - inter
    jacc = inter / union if union else 0.0
    cover_a = inter / len(ta) if ta else 0.0
    cover_b = inter / len(tb) if tb else 0.0
    # якщо більшість слів запиту є в назві меню (навіть якщо меню довше)
    return max(jacc, cover_a * 0.92, min(cover_a, cover_b) * 0.95)


def _item_key(item: MenuItemRow) -> int:
    return getattr(item, "dish_id", None) or item.id


def match_part_to_menu(part: str, menu: Sequence[MenuItemRow], min_score: float = 0.42) -> MatchedPart:
    norm = normalize_dish_name(part)
    ranked: list[tuple[float, MenuItemRow]] = []
    for item in menu:
        best_for_item = 0.0
        for cand in [item.name_norm, *getattr(item, "synonym_norms", ())]:
            if not cand:
                continue
            sc = _similarity(norm, cand)
            if sc >= 1.0 and cand != item.name_norm:
                # точний синонім трохи слабший за точну канонічну назву іншої страви
                sc = _SYNONYM_EXACT_SCORE
            best_for_item = max(best_for_item, sc)
        if best_for_item > 0:
            ranked.append((best_for_item, item))
    if not ranked:
        return MatchedPart(raw=part, item=None, score=0.0)
    # sort стабільний: при рівних score порядок меню, але рівність нижче вважається неоднозначністю
    ranked.sort(key=lambda x: -x[0])
    top_score, top_item = ranked[0]
    if top_score < min_score:
        return MatchedPart(raw=part, item=None, score=top_score)
    if top_score >= _SYNONYM_EXACT_SCORE:
        # точний збіг (назва/синонім): конкурент лише ще один точний збіг того самого рангу
        rivals = [
            it for sc, it in ranked[1:]
            if sc >= top_score - 1e-9 and _item_key(it) != _item_key(top_item)
        ]
    else:
        floor = max(min_score, top_score - AMBIGUITY_MARGIN)
        rivals = [it for sc, it in ranked[1:] if sc >= floor and _item_key(it) != _item_key(top_item)]
    if rivals:
        return MatchedPart(
            raw=part,
            item=None,
            score=top_score,
            alternatives=[top_item.name, *[r.name for r in rivals]],
        )
    return MatchedPart(raw=part, item=top_item, score=top_score)


def _try_split_hard_unmatched(part: str) -> list[str]:
    """Додатковий розпил нерозпізнаного фрагмента."""
    # «бифштекс с яйцом печень оладьи» без подвійних пробілів — евристика по ключових словах
    low = normalize_dish_name(part)
    markers = [
        "біфштекс",
        "бифштекс",
        "печінкові",
        "печень",
        "оладки",
        "оладьи",
        "котлети",
        "філе",
        "суп",
        "салат",
        "пюре",
        "гречка",
        "рис",
        "овочі",
        "сирники",
        "вареники",
    ]
    # якщо є 2+ маркери — ріжемо перед другим і далі
    positions: list[tuple[int, str]] = []
    for m in markers:
        idx = low.find(m)
        if idx >= 0:
            positions.append((idx, m))
    positions.sort()
    if len(positions) < 2:
        return [part]
    # розрізати оригінал пропорційно? простіше: split по знайдених маркерах у norm і map назад — важко.
    # Ріжемо low і беремо шматки як окремі parts (вже нормалізовані тексти ок для match)
    cuts = [p[0] for p in positions]
    pieces: list[str] = []
    for i, start in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < len(cuts) else len(low)
        piece = low[start:end].strip()
        if piece:
            pieces.append(piece)
    return pieces if len(pieces) >= 2 else [part]


# Посилання (чек monobank) і згадки (@оператор) — не страви: не шукаємо в меню й не звітуємо «не розпізнав».
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_MENTION_RE = re.compile(r"(?<![\w@])@\w+")
# Номер пункту списку («3.гречка», «2) пюре») — не кількість.
_LIST_INDEX_RE = re.compile(r"^\s*\d{1,2}\s*[.)]\s*(?=\D)")
# Частина називає те, чого НЕ треба: «Дерунов нету», «Небуде 1 голубців», «Крабовий закінчився замініть»,
# «Замість пюре, …», «Немає зеленого борща». Таку частину не записуємо й не перепитуємо.
_NEGATION_RE = re.compile(
    r"(?<!\w)(?:не\s*буде\w*|не\s*будет|не\s*треба|не\s*надо|нема\w*|нету|нет"
    r"|закінчи\w*|закончи\w*|замість|вместо)(?!\w)",
    re.IGNORECASE,
)
# Кількість: «2 хліба», «хліб 2», «Хліб 4 шт», «Голубці ліниві 2 порції», «х2 пюре», «котлети ×2».
_QTY_UNIT = r"(?:шт|штук[аи]?|порці[яїйю]?|порци[яийю]?|порц)\.?"
_QTY_LEAD_RE = re.compile(
    rf"^\s*(?:[x×х]\s*)?(\d{{1,2}})(?:\s*[x×х](?![^\W\d_])|\s*{_QTY_UNIT}(?![^\W\d_]))?\s+(?=\S)",
    re.IGNORECASE,
)
_QTY_TAIL_RE = re.compile(
    rf"(?<=\S)\s+(?:[x×х]\s*)?(\d{{1,2}})(?:\s*(?:[x×х]|{_QTY_UNIT}))?\s*$",
    re.IGNORECASE,
)
_MAX_QTY = 10
# Сполучники/пробіли всередині частини: «гречка і філе курки з помідором», «пюре + котлети»,
# «бифштекс с яйцом  печень оладьи». Ріжемо лише коли кожен шматок — окрема страва з меню.
_JOIN_SPLIT_RE = re.compile(r"\s+(?:і|и|та|\+|&)\s+|\s{2,}", re.IGNORECASE)
# Текст без роздільників довше за стільки слів не сегментуємо (це вже не одне замовлення)
_MAX_SEGMENT_TOKENS = 12
# Шматок сегментації має збігатися впевнено: «сирний» ≈ «Сирники» (0.69) — не привід різати «салат крабово сирний»
_SEGMENT_MIN_SCORE = 0.8


def _clean_part(part: str) -> str:
    t = _URL_RE.sub(" ", part)
    t = _MENTION_RE.sub(" ", t)
    t = _LIST_INDEX_RE.sub("", t)
    return t.strip(" \t:-–—")


def _split_qty(part: str) -> tuple[str, int]:
    """«2 хліба» → («хліба», 2); «Голубці ліниві 2 порції» → («Голубці ліниві», 2); без числа — (part, 1)."""
    for rx in (_QTY_LEAD_RE, _QTY_TAIL_RE):
        m = rx.search(part)
        if not m:
            continue
        qty = int(m.group(1))
        rest = (part[: m.start()] + " " + part[m.end():]).strip()
        if 1 <= qty <= _MAX_QTY and rest:
            return rest, qty
    return part, 1


def _match_counted(part: str, menu: Sequence[MenuItemRow], min_score: float) -> tuple[MatchedPart, int]:
    body, qty = _split_qty(part)
    m = match_part_to_menu(body, menu, min_score=min_score)
    if m.item is None and body != part:
        # число може бути частиною назви страви — тоді без кількості
        whole = match_part_to_menu(part, menu, min_score=min_score)
        if whole.item is not None:
            return MatchedPart(raw=part, item=whole.item, score=whole.score), 1
    return MatchedPart(raw=part, item=m.item, score=m.score, alternatives=m.alternatives), qty


def _covers_all_words(span: str, item: MenuItemRow) -> bool:
    """Кожне значуще слово шматка є в назві або одному синонімі страви (шматок не «зʼїдає» сусідню страву)."""
    words = _token_set(span)
    for cand in [item.name_norm, *getattr(item, "synonym_norms", ())]:
        if cand and _overlap(words, _token_set(cand))[0] == len(words):
            return True
    return False


def _names_dish_by_head(span: str, item: MenuItemRow) -> bool:
    """Шматок з одного слова — це назва страви, лише якщо слово головне (перше значуще в назві чи синонімі):
    «гречка», «котлети», «оливье» — так; «цибулею» з «Печінка смажена з цибулею» — ні (це опис іншої страви)."""
    words = _token_set(span) - GENERIC_TOKENS
    if len(words) != 1:
        return True
    (word,) = words
    for cand in [item.name_norm, *getattr(item, "synonym_norms", ())]:
        head = next((t for t in cand.split() if len(t) > 1 and t not in GENERIC_TOKENS), None)
        if head and _token_match_weight(word, head) > 0:
            return True
    return False


def _confident_piece(span: str, m: MatchedPart, *, guessed_bounds: bool) -> bool:
    """Шматок розрізаного тексту, якому можна вірити: страва знайдена і шматок — не «хвіст» іншої назви.
    guessed_bounds — межі шматків вгадуємо ми (текст без роздільників): тоді ще й впевнений збіг і кожне
    слово шматка з цієї страви. Інакше різати не варто: краще одна страва чи перепитати, ніж вигадати другу."""
    if m.item is None:
        return False
    norm = normalize_dish_name(span)
    if guessed_bounds and (m.score < _SEGMENT_MIN_SCORE or not _covers_all_words(norm, m.item)):
        return False
    return _names_dish_by_head(norm, m.item)


def _segment_by_menu(part: str, menu: Sequence[MenuItemRow], min_score: float) -> Optional[list[MatchedPart]]:
    """Текст без роздільників («Печінка смажена салат капуста огірок деруни») → найменше шматків, кожен з яких —
    окрема страва меню, що містить усі слова шматка. None — якщо так покрити весь текст не вдається."""
    toks = normalize_dish_name(part).split()
    if len(_token_set(" ".join(toks))) < 3 or len(toks) > _MAX_SEGMENT_TOKENS:
        return None
    n = len(toks)
    # best[i] = (кількість шматків, −сума score, шматки) для toks[:i]
    best: dict[int, tuple[int, float, list[MatchedPart]]] = {0: (0, 0.0, [])}
    for i in range(1, n + 1):
        for j in range(i):
            if j not in best:
                continue
            span = " ".join(toks[j:i])
            if not _token_set(span):
                continue
            m = match_part_to_menu(span, menu, min_score=min_score)
            if not _confident_piece(span, m, guessed_bounds=True):
                continue
            prev = best[j]
            cand = (prev[0] + 1, prev[1] - m.score, [*prev[2], m])
            if i not in best or cand[:2] < best[i][:2]:
                best[i] = cand
    if n not in best or best[n][0] < 2:
        return None
    pieces = best[n][2]
    keys = [_item_key(m.item) for m in pieces if m.item is not None]
    return pieces if len(set(keys)) == len(keys) else None


def _resolve_part(part: str, menu: Sequence[MenuItemRow], min_score: float) -> list[tuple[MatchedPart, int]]:
    """Одна частина замовлення → страви (з кількістю); нерозпізнане — MatchedPart без item."""
    whole, qty = _match_counted(part, menu, min_score)
    if whole.item is not None and whole.score >= _SYNONYM_EXACT_SCORE:
        return [(whole, qty)]
    pieces = [p.strip() for p in _JOIN_SPLIT_RE.split(part) if p and p.strip()]
    if len(pieces) >= 2:
        sub = [_match_counted(p, menu, min_score) for p in pieces]
        keys = [_item_key(m.item) for m, _q in sub if m.item is not None]
        confident = all(
            _confident_piece(_split_qty(p)[0], m, guessed_bounds=False) for p, (m, _q) in zip(pieces, sub)
        )
        if confident and len(keys) == len(sub) and len(set(keys)) == len(keys):
            return sub
    body, _qty = _split_qty(part)
    if whole.item is not None and _covers_all_words(normalize_dish_name(body), whole.item):
        return [(whole, qty)]
    # слова, яких у знайденій страві немає (або нічого не знайдено): може, це кілька страв без роздільників
    seg = _segment_by_menu(body, menu, min_score)
    if seg:
        return [(m, 1) for m in seg]
    if whole.item is not None:
        return [(whole, qty)]
    # остання спроба: розпил за ключовими словами «бифштекс с яйцом печень оладьи»
    subs = [sub for sub in _try_split_hard_unmatched(part) if sub.strip() != part.strip()]
    if subs:
        return [_match_counted(sub, menu, min_score) for sub in subs]
    return [(whole, qty)]


def parse_order(text: str, menu: Sequence[MenuItemRow], min_score: float = 0.42) -> OrderParseResult:
    parts = split_order_parts(text, double_space=False)
    matched: list[MatchedPart] = []
    unmatched: list[str] = []
    ambiguous: dict[str, list[str]] = {}
    lines: list[OrderLineInput] = []
    by_id: dict[int, OrderLineInput] = {}

    def add_match(m: MatchedPart, qty: int = 1) -> None:
        matched.append(m)
        if m.item is None:
            unmatched.append(m.raw)
            if m.alternatives:
                ambiguous[m.raw] = m.alternatives
            return
        key = getattr(m.item, "dish_id", None) or m.item.id
        existing = by_id.get(key)
        if existing:
            existing.qty += qty
            existing.line_total_uah = existing.qty * existing.unit_price_uah
        else:
            line = OrderLineInput(
                menu_item_id=m.item.id,
                dish_id=getattr(m.item, "dish_id", None),
                # Канонічна назва з меню (як у ручному редагуванні в адмінці)
                raw_name=m.item.name,
                as_written=m.raw,
                qty=qty,
                unit_price_uah=m.item.price_uah,
                line_total_uah=qty * m.item.price_uah,
                tray_role=getattr(m.item, "tray_role", None) or "second",
            )
            by_id[key] = line
            lines.append(line)

    for raw_part in parts:
        part = _clean_part(raw_part)
        if not part or _NEGATION_RE.search(part):
            continue
        for m, qty in _resolve_part(part, menu, min_score):
            add_match(m, qty)

    total = sum(l.line_total_uah for l in lines)
    # прибрати з unmatched порожні / дублікати після успішного match того ж raw
    unmatched = [u for u in unmatched if u and u.strip()]
    return OrderParseResult(
        lines=lines, total_uah=total, matched=matched, unmatched=unmatched, ambiguous=ambiguous
    )


def parse_order_contextual(
    text: str,
    today_menu: Sequence[MenuItemRow],
    fallback_menu: Sequence[MenuItemRow] | None = None,
    *,
    today_published: bool = True,
    min_score: float = 0.42,
) -> OrderParseResult:
    """
    Сьогоднішнє меню + fallback (вчора).
    Якщо сьогоднішнього ще немає — тихо приймаємо з вчорашнього.
    Якщо сьогодні вже є, а страва лише з вчора — unavailable (не в заказ).
    """
    fallback_menu = fallback_menu or []
    if today_menu:
        today_published = True
        result = parse_order(text, today_menu, min_score=min_score)
        if not fallback_menu:
            return result
        leftover = list(result.unmatched)
        if not leftover:
            return result
        unavailable: list[str] = []
        still_unmatched: list[str] = []
        extra_matched: list[MatchedPart] = []
        for part in leftover:
            if part in result.ambiguous:
                # на сьогоднішнє меню підходить кілька страв — це не «сьогодні немає»
                still_unmatched.append(part)
                continue
            extra = parse_order(part, fallback_menu, min_score=min_score)
            extra_matched.extend(extra.matched)
            if extra.lines:
                unavailable.extend(ln.raw_name for ln in extra.lines)
            still_unmatched.extend(extra.unmatched)
        return OrderParseResult(
            lines=result.lines,
            total_uah=result.total_uah,
            matched=result.matched + extra_matched,
            unmatched=still_unmatched,
            unavailable=unavailable,
            ambiguous=dict(result.ambiguous),
        )

    if fallback_menu:
        # Меню сьогодні ще немає — тихо з вчорашнього
        return parse_order(text, fallback_menu, min_score=min_score)

    return parse_order(text, [], min_score=min_score)


def looks_like_order(text: str) -> bool:
    """Грубий фільтр: не команда, не привітання/подяка, не денний підсумок.

    Раніше тут була додаткова вимога "3+ слів без роздільників", яка мала
    відсіювати одно-двослівний чат-шум (типу "Ок", "Клас"). Але вона ж
    відсікала й цілком легітимні короткі замовлення однієї страви
    ("Гречка", "Салат оригінальний") — вони мовчки ігнорувалися навіть
    при reparse. Справжнім фільтром точності є збіг з реальним меню
    (parse_order_contextual, min_score) — тут лишаємо тільки грубий
    відсів очевидного не-замовлення.
    """
    t = (text or "").strip()
    if not t or t.startswith("!"):
        return False
    if len(t) < 3:
        return False
    from .parse_summary import looks_like_day_summary

    if looks_like_day_summary(t):
        return False
    low = t.lower()
    if low.startswith(("оплат", "скид", "дякую", "спасибо", "бегом", "даша")):
        return False
    return True
