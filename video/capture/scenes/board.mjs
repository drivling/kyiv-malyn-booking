/**
 * Сцена F4 (табло в кишені): табло зупинки «м-н "Промінь"» о 07:40 понеділка — №7, №9, №8 «через 5 хв».
 * Кадри: сторінка 0–19, прокрутка до відправлень 20–44, кінець 80.
 */
export default {
  name: 'board',
  url: '/transport/stop/st_0049',
  now: '2026-11-16T05:40:00Z',
  ready: { role: 'heading', name: /Промінь/ },
  frames: 80,
  actions: [{ frame: 20, scrollTo: { text: 'Відправлення ·', align: 0.1, frames: 24 } }],
};
