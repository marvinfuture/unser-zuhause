import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskHistoryPage, TaskRevision } from '../shared/task-history.js';
import { loadLatestHistory } from '../src/TaskHistory.js';

test('Der Verlauf schließt Lücken über mehrere Seiten und behält bereits geladene ältere Änderungen', async () => {
  const revisions: TaskRevision[] = Array.from({ length: 113 }, (_, index) => ({
    version: 113 - index,
    actor: 'marvin',
    at: '2026-11-19T10:00:00Z',
    action: 'changed',
    changes: [],
  }));
  const calls: (number | undefined)[] = [];
  /** Liefert wie die API maximal 25 chronologisch absteigende Änderungen vor dem exklusiven Cursor. */
  async function readPage(before?: number): Promise<TaskHistoryPage> {
    calls.push(before);
    const available = revisions.filter(({ version }) => before === undefined || version < before);
    const entries = available.slice(0, 25);
    return {
      entries,
      nextBefore: available.length > 25 ? entries.at(-1)!.version : null,
      partial: false,
    };
  }

  const first = await loadLatestHistory(readPage);
  assert.deepEqual(first.entries, revisions.slice(0, 25));
  assert.deepEqual(calls, [undefined]);
  calls.length = 0;

  const known = {
    entries: revisions.filter(({ version }) => version <= 60 && version > 10),
    nextBefore: 11,
    partial: false,
  };
  const refreshed = await loadLatestHistory(readPage, known);
  assert.deepEqual(calls, [undefined, 89, 64]);
  assert.deepEqual(
    refreshed.entries,
    revisions.filter(({ version }) => version > 10),
  );
  assert.equal(refreshed.nextBefore, 11);

  calls.length = 0;
  assert.deepEqual(await loadLatestHistory(readPage, refreshed), refreshed);
  assert.deepEqual(calls, [undefined]);
});
