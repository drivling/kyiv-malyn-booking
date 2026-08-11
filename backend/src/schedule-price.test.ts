import assert from 'node:assert/strict';
import { test } from 'vitest';
import { defaultSchedulePriceUah, parseOptionalPriceUah } from './schedule-price';

test('defaultSchedulePriceUah: Irpin/Bucha corridors', () => {
  assert.equal(defaultSchedulePriceUah('Kyiv-Malyn-Irpin'), 280);
  assert.equal(defaultSchedulePriceUah('Malyn-Kyiv-Bucha'), 280);
  assert.equal(defaultSchedulePriceUah('Malyn-Zhytomyr'), null);
  assert.equal(defaultSchedulePriceUah('Zhytomyr-Malyn'), null);
});

test('parseOptionalPriceUah', () => {
  assert.equal(parseOptionalPriceUah(undefined), undefined);
  assert.equal(parseOptionalPriceUah(null), null);
  assert.equal(parseOptionalPriceUah(''), null);
  assert.equal(parseOptionalPriceUah(280), 280);
  assert.equal(parseOptionalPriceUah('280.4'), 280);
});
