import test from 'node:test';
import assert from 'node:assert/strict';
import { newPasswordSchema } from '../services/api/password-policy.mjs';

test('new passwords require 8–200 characters, uppercase, lowercase and a number', () => {
  for (const value of ['Abcdef12', 'Ab1!xyzz', 'Aa1' + 'x'.repeat(197)]) {
    assert.equal(newPasswordSchema.safeParse(value).success, true);
  }
  for (const value of ['Abcde12', 'abcdefgh1', 'ABCDEFGH1', 'Abcdefgh', '12345678', 'Aa1' + 'x'.repeat(198)]) {
    assert.equal(newPasswordSchema.safeParse(value).success, false, value.length > 200 ? 'over maximum' : value);
  }
});
