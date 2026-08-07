import assert from 'node:assert/strict';
import { defaultSchedulePriceUah, parseOptionalPriceUah } from './schedule-price';

assert.equal(defaultSchedulePriceUah('Kyiv-Malyn-Irpin'), 280);
assert.equal(defaultSchedulePriceUah('Malyn-Kyiv-Bucha'), 280);
assert.equal(defaultSchedulePriceUah('Malyn-Zhytomyr'), null);
assert.equal(defaultSchedulePriceUah('Zhytomyr-Malyn'), null);

assert.equal(parseOptionalPriceUah(undefined), undefined);
assert.equal(parseOptionalPriceUah(null), null);
assert.equal(parseOptionalPriceUah(''), null);
assert.equal(parseOptionalPriceUah(280), 280);
assert.equal(parseOptionalPriceUah('280.4'), 280);

console.log('schedule-price.test.ts: ok');
