/**
 * Юніт-тести хелперів покупки квитків на електричку (Telegram /book).
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildElektrichkaPurchaseMessage,
  buildElektrichkaPurchaseKeyboard,
} from './telegram';

describe('buildElektrichkaPurchaseMessage', () => {
  it('includes carrier app copy, time, route and trip number', () => {
    const text = buildElektrichkaPurchaseMessage(
      {
        route: 'Kyiv-Malyn',
        departureTime: '07:30',
        tripNumber: '6102',
        ticketPurchaseUrl: 'https://tickets.example/buy',
      },
      { dateLabel: '12.08.2026', routeDisplayName: 'Київ → Малин' }
    );
    assert.match(text, /Квитки на електричку купуються в застосунку перевізника/);
    assert.match(text, /07:30/);
    assert.match(text, /Київ → Малин/);
    assert.match(text, /6102/);
    assert.match(text, /12\.08\.2026/);
  });

  it('omits trip line when tripNumber is missing', () => {
    const text = buildElektrichkaPurchaseMessage({
      route: 'Malyn-Kyiv',
      departureTime: '18:00',
      tripNumber: null,
      ticketPurchaseUrl: null,
    });
    assert.doesNotMatch(text, /Номер рейсу/);
    assert.match(text, /Малин → Київ/);
  });
});

describe('buildElektrichkaPurchaseKeyboard', () => {
  it('adds URL button when ticketPurchaseUrl is set', () => {
    const kb = buildElektrichkaPurchaseKeyboard({
      route: 'Kyiv-Malyn',
      departureTime: '07:30',
      ticketPurchaseUrl: 'https://tickets.example/buy',
    });
    assert.equal(kb.inline_keyboard[0][0].text, '🎫 Купити квиток');
    assert.equal(kb.inline_keyboard[0][0].url, 'https://tickets.example/buy');
    assert.equal(kb.inline_keyboard[1][0].callback_data, 'book_cancel');
  });

  it('skips URL button when purchase url is empty', () => {
    const kb = buildElektrichkaPurchaseKeyboard({
      route: 'Kyiv-Malyn',
      departureTime: '07:30',
      ticketPurchaseUrl: '  ',
    });
    assert.equal(kb.inline_keyboard.length, 1);
    assert.equal(kb.inline_keyboard[0][0].callback_data, 'book_cancel');
  });
});
