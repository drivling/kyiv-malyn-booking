/** Телефони «Зубастика» на сторінках: типові одразу, з сервера — щойно прийдуть; читаємо раз; збій — типові. */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { PhoneOnlyNotice } from '@/pages/MizhgorodskiPage/PhoneOnlyNotice';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import { loadZubastykPhones, resetZubastykPhones, zubastykPhonesNow } from './zubastykPhones';

afterEach(() => resetZubastykPhones());

describe('телефони «Зубастика» з адмінки', () => {
  it('попередження в модалці бронювання показує номери з сервера', async () => {
    let calls = 0;
    server.use(
      http.get(`${TEST_API_URL}/site/zubastyk-phones`, () => {
        calls++;
        return HttpResponse.json({ phones: [{ digits: '380671112233', label: '067 111 22 33' }] });
      }),
    );
    render(<PhoneOnlyNotice />);
    expect(screen.getByRole('link', { name: '093 192 00 08' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '067 111 22 33' })).toHaveAttribute('href', 'tel:+380671112233');
    expect(screen.queryByRole('link', { name: '093 192 00 08' })).toBeNull();
    await loadZubastykPhones();
    expect(calls).toBe(1);
  });

  it('збій чи дивна відповідь — лишаються типові', async () => {
    server.use(http.get(`${TEST_API_URL}/site/zubastyk-phones`, () => HttpResponse.json({ phones: [{ digits: '12', label: 'x' }] })));
    await loadZubastykPhones();
    expect(zubastykPhonesNow()).toBe(ZUBASTYK_PHONES);
    resetZubastykPhones();
    server.use(http.get(`${TEST_API_URL}/site/zubastyk-phones`, () => new HttpResponse(null, { status: 500 })));
    await loadZubastykPhones();
    expect(zubastykPhonesNow()).toBe(ZUBASTYK_PHONES);
  });
});
