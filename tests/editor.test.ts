import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeEditorConflict, recordFormValues } from '../src/editor-values.js';
import type { ShoppingItem } from '../shared/types.js';

test('Einkaufskonflikt behält eigene Menge und übernimmt fremde Bezeichnung, Preis und Kaufstatus', () => {
  const original: ShoppingItem = {
    id: 'einkauf',
    title: 'Farbe',
    projectId: null,
    category: 'material',
    quantity: 1,
    unit: 'Liter',
    unitPriceCents: null,
    purchased: false,
    purchasedBy: null,
    createdBy: 'karla',
    updatedBy: 'karla',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    archivedAt: null,
    version: 1,
  };
  const draft: Record<string, any> = { ...recordFormValues('shopping', original), quantity: '2' };
  const current: ShoppingItem = {
    ...original,
    title: 'Wandfarbe',
    unitPriceCents: 899,
    purchased: true,
    purchasedBy: 'marvin',
    updatedBy: 'marvin',
    version: 2,
  };
  const editable = ['title', 'quantity', 'unitPriceCents', 'purchased'];
  const merged = mergeEditorConflict('shopping', editable, draft, original, current);
  assert.equal(merged.quantity, '2');
  assert.equal(merged.title, 'Wandfarbe');
  assert.equal(merged.unitPriceCents, '8.99');
  assert.equal(merged.purchased, true);
  assert.equal(draft.unitPriceCents, '');
  const ownPrice = mergeEditorConflict(
    'shopping',
    editable,
    { ...draft, unitPriceCents: '6.45' },
    original,
    current,
  );
  assert.equal(ownPrice.unitPriceCents, '6.45');
});
