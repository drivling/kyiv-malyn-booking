/** «17 листопада о 23:45» за Києвом */
export const quotaTime = (iso: string) => new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Що означає відмова Google — куди дивитись у Google Cloud */
export const googleErrorHint = (status: number) =>
  status === 429
    ? 'вичерпано квоту в Google Cloud: вона менша за наш ліміт або її вибрали інші скрипти'
    : status === 401 || status === 403
      ? 'немає доступу: обмеження ключа, вимкнений Routes API або білінг'
      : 'збій на боці Google або запит не прийнято';

/** Один рядок про останню відмову Google (адмінка: «Огляд» і «Місто») */
export const googleErrorLine = (e: { at: string; status: number; message: string }) =>
  `Google відмовив (HTTP ${e.status}) ${quotaTime(e.at)} — ${googleErrorHint(e.status)}${e.message ? `; Google: «${e.message}»` : ''}`;
