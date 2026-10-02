import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesItemsWithAttention } from '../apps/web/src/reviewAttention.mjs';

test('groups review validation by stable original item number', () => {
  const items = [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }, { text: 'Five' }];
  const indexed = minutesItemsWithAttention(items, [
    'Item 5: the owner is not named in the source quote.',
    'Item 5: the deadline is not stated in the source (YYYY-MM-DD).',
    'Item 2 is empty.',
    'Add a summary and at least one minutes item.'
  ]);

  assert.deepEqual(indexed.map(entry => entry.number), [1, 2, 3, 4, 5]);
  assert.equal(indexed[1].issues[0], 'is empty.');
  assert.equal(indexed[4].issues.length, 2);
  assert.equal(indexed.filter(entry => entry.issues.length).length, 2);
});
