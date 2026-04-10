import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPhone } from './viber-parser';

const cases: { input: string; expected: string | null; name?: string }[] = [
  { input: '+380 (68) 721 14 77', expected: '+380687211477', name: 'дужки навколо коду' },
  { input: '+380-50-123-45-67', expected: '+380501234567', name: '+380 з дефісами' },
  { input: '+380 50-123 45-67', expected: '+380501234567', name: '+380 змішані дефіси/пробіли' },
  { input: '050-123-45-67', expected: '0501234567', name: '0XX з дефісами' },
  { input: '050 123 45 67', expected: '0501234567', name: '0XX з пробілами' },
  { input: '0501234567', expected: '0501234567', name: '0XX суцільно' },
  { input: '+380501234567', expected: '+380501234567', name: '+380 суцільно' },
  { input: 'тел: 050-111-22-33 зараз', expected: '0501112233', name: 'у тексті' },
  { input: '10.04.2026 лише дата без номера', expected: null, name: 'немає номера' },
];

for (const { input, expected, name } of cases) {
  test(name ?? input, () => {
    assert.equal(extractPhone(input), expected);
  });
}
