-- «Доведе» · дорога містом: 17 листопада Google відповідав 429 (вичерпана квота), а навчання вважало це невдачею
-- пари й ставило їй паузу на тиждень. Тепер 429 — це «ліміт» без позначок; поставлені за той час позначки знімаємо.
-- Нічого не видаляється: обидві колонки — лише «коли не вдалося», на відповіді людям не впливають.
UPDATE "DovedeCityDemand" SET "learnFailedAt" = NULL WHERE "learnFailedAt" IS NOT NULL;
UPDATE "DovedeCityRoute" SET "refreshFailedAt" = NULL WHERE "refreshFailedAt" IS NOT NULL;
