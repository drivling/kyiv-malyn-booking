import { test } from 'vitest';
import assert from 'node:assert/strict';
import { displayName, firstNameOnly } from './person-name';

test('firstNameOnly: лише перше слово імені', () => {
  assert.equal(firstNameOnly('Іван Петренко'), 'Іван');
  assert.equal(firstNameOnly('  Олена   Іванівна Коваль '), 'Олена');
  assert.equal(firstNameOnly('Сергій'), 'Сергій');
  assert.equal(firstNameOnly('Анна-Марія Шевченко'), 'Анна-Марія');
  assert.equal(firstNameOnly(''), null);
  assert.equal(firstNameOnly('   '), null);
  assert.equal(firstNameOnly(null), null);
  assert.equal(firstNameOnly(undefined), null);
});

test('displayName: перше слово або fallback', () => {
  assert.equal(displayName('Іван Петренко', 'Водій'), 'Іван');
  assert.equal(displayName(null, 'Водій'), 'Водій');
  assert.equal(displayName('  ', 'Пасажир'), 'Пасажир');
  assert.equal(displayName(undefined, '—'), '—');
});
