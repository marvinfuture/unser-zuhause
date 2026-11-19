import type { BaseRecord, Collection } from '../shared/types';

type StoredRecord = BaseRecord & Record<string, any>;

/** Überträgt gespeicherte Werte in die Eingabefelder, einschließlich des Einkaufspreises in Euro. */
export function recordFormValues(
  collection: Collection,
  record?: StoredRecord,
): Record<string, any> {
  if (!record) return {};
  if (collection !== 'shopping') return record;
  return {
    ...record,
    unitPriceCents: record.unitPriceCents === null ? '' : (record.unitPriceCents / 100).toFixed(2),
  };
}

/** Übernimmt nach der Konfliktbestätigung die fremden Änderungen an lokal unberührten Feldern. */
export function mergeEditorConflict(
  collection: Collection,
  fields: string[],
  draft: Record<string, any>,
  base: StoredRecord,
  current: StoredRecord,
): Record<string, any> {
  const previous = recordFormValues(collection, base);
  const latest = recordFormValues(collection, current);
  const merged = { ...draft };
  for (const field of fields) {
    if (JSON.stringify(draft[field]) === JSON.stringify(previous[field]))
      merged[field] = latest[field];
  }
  return merged;
}
