import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { dueCalendarReminders } from '../server/calendar.js';
import {
  calendarOccurrences,
  hasOccurrence,
  openCalendarReminders,
  reminderDate,
  validDay,
  type CalendarData,
  type CalendarOverride,
  type CalendarSeries,
} from '../shared/calendar.js';
import type { ProfileId, Session } from '../shared/types.js';

/** Erzeugt eine synthetische vierwöchige Haushaltsserie für die Datums- und API-Prüfungen. */
function example(): CalendarSeries {
  return {
    id: randomUUID(),
    title: 'Küchenpapier',
    kind: 'household',
    startDay: '2026-02-01',
    endDay: null,
    everyWeeks: 4,
    remindDays: 1,
    remindTime: '18:00',
    profileIds: ['karla', 'marvin'],
    version: 1,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'karla',
    updatedBy: 'karla',
  };
}

test('Wochenintervalle, Monatswechsel, Einzeltermine und inklusive Seriengrenze', () => {
  const series = example();
  assert.equal(validDay('2024-02-29'), true);
  assert.equal(validDay('2025-02-29'), false);
  assert.equal(validDay('2026-04-31'), false);
  assert.equal(hasOccurrence(series, '2026-03-29'), true);
  assert.equal(hasOccurrence(series, '2026-03-22'), false);
  assert.deepEqual(
    calendarOccurrences({ series: [series], overrides: [] }, '2026-02-02', '2026-03-31').map(
      (i) => i.day,
    ),
    ['2026-03-01', '2026-03-29'],
  );
  assert.deepEqual(
    calendarOccurrences(
      { series: [{ ...series, everyWeeks: 2, endDay: '2026-03-01' }], overrides: [] },
      '2026-02-01',
      '2026-03-30',
    ).map((i) => i.day),
    ['2026-02-01', '2026-02-15', '2026-03-01'],
  );
  assert.deepEqual(
    calendarOccurrences(
      { series: [{ ...series, everyWeeks: null }], overrides: [] },
      '2026-02-02',
      '2026-06-01',
    ),
    [],
  );
});

test('Erinnerung am Berliner Vortag einschließlich Zeitumstellungen und Festhalten bis zum Abhaken', () => {
  const series = example();
  assert.equal(reminderDate(series, '2026-03-29')?.toISOString(), '2026-03-28T17:00:00.000Z');
  assert.equal(reminderDate(series, '2026-03-30')?.toISOString(), '2026-03-29T16:00:00.000Z');
  assert.equal(
    reminderDate({ ...series, remindDays: 0, remindTime: '02:30' }, '2026-03-29')?.toISOString(),
    '2026-03-29T01:30:00.000Z',
  );
  assert.equal(
    reminderDate({ ...series, remindDays: 0, remindTime: '02:30' }, '2026-10-25')?.toISOString(),
    '2026-10-25T00:30:00.000Z',
  );
  const data = { series: [{ ...series, profileIds: ['karla'] as ProfileId[] }], overrides: [] };
  assert.equal(openCalendarReminders(data, 'karla', new Date('2026-02-28T16:59:59Z')).length, 1);
  assert.equal(openCalendarReminders(data, 'karla', new Date('2026-02-28T17:00:00Z')).length, 2);
  assert.equal(openCalendarReminders(data, 'marvin', new Date('2026-03-30T18:00:00Z')).length, 0);
});

/** Hält eine eigene Testsitzung pro Gerät und sendet geschützte Kalenderaktionen gegen den isolierten Server. */
async function device(origin: string, profileId: ProfileId) {
  const opened = await fetch(origin + '/api/session');
  const cookie = opened.headers.get('set-cookie')!.split(';')[0];
  let session: Session = await opened.json();
  /** Sendet einen Request mit dem aktuell bestätigten Namensschild und optional gezielt veralteten Angaben. */
  async function send(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    csrf = session.csrfToken,
  ) {
    return fetch(origin + '/api' + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      ...(body
        ? { body: JSON.stringify({ profileVersion: session.profileVersion, ...body }) }
        : {}),
    });
  }
  const chosen = await send('POST', '/profile', { profileId });
  assert.equal(chosen.status, 200);
  session = await chosen.json();
  return { send, session };
}

/** Startet einen isolierten Haushalt und räumt Server, Datenbank und Testdaten nach jeder Kalenderprüfung auf. */
async function testHousehold(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'unser-zuhause-kalender-'));
  const ctx = createApp({ dataDir: path });
  const server = ctx.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.db.close();
    await rm(path, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  return { ctx, origin };
}

test('Zwei Geräte bearbeiten Müllserien und übertragen einen einzelnen Haushaltsbedarf höchstens einmal', async (t) => {
  const { ctx, origin } = await testHousehold(t);
  assert.equal((await fetch(origin + '/api/calendar')).status, 401);
  const karla = await device(origin, 'karla'),
    marvin = await device(origin, 'marvin');
  const base = example();
  const { title, kind, startDay, endDay, everyWeeks, remindDays, remindTime, profileIds } = base;
  const input = {
    title,
    kind,
    startDay,
    endDay,
    everyWeeks,
    remindDays,
    remindTime,
    profileIds,
    requestId: randomUUID(),
  };
  assert.equal((await karla.send('POST', '/calendar', input, '')).status, 403);
  assert.equal(
    (await karla.send('POST', '/calendar', { ...input, profileVersion: 0 })).status,
    409,
  );
  const created = await karla.send('POST', '/calendar', input);
  assert.equal(created.status, 201);
  const series: CalendarSeries = await created.json();
  assert.equal(series.createdBy, 'karla');
  assert.equal((await (await karla.send('POST', '/calendar', input)).json()).id, series.id);
  assert.equal(
    (await karla.send('POST', '/calendar', { ...input, title: 'Anderer Titel' })).status,
    409,
  );
  assert.equal(
    (await karla.send('PATCH', '/calendar/' + series.id, { version: 1, endDay: '2026-01-31' }))
      .status,
    400,
  );
  const pathTo = '/calendar/' + series.id + '/occurrences/';
  const versions = { version: 0, seriesVersion: 1 };
  assert.equal(
    (await karla.send('POST', pathTo + '2026-02-04', { ...versions, action: 'done' })).status,
    404,
  );
  const moved = await marvin.send('POST', pathTo + '2026-03-01', {
    ...versions,
    action: 'move',
    movedTo: '2026-04-12',
  });
  assert.equal(moved.status, 200);
  assert.equal(
    (await karla.send('POST', pathTo + '2026-03-01', { ...versions, action: 'skip' })).status,
    409,
  );
  const data = await (await karla.send('GET', '/calendar')).json();
  assert.deepEqual(
    calendarOccurrences(data, '2026-04-12', '2026-04-12').map((i) => [i.day, i.originalDay]),
    [['2026-04-12', '2026-03-01']],
  );
  assert.deepEqual(calendarOccurrences(data, '2026-03-01', '2026-03-01'), []);
  const dueAt = new Date('2026-04-11T16:00:00Z');
  const reminder = dueCalendarReminders(ctx.db, dueAt);
  assert.equal(reminder.length, 1);
  assert.equal(reminder[0].key, series.id + ':2026-03-01');
  assert.deepEqual(reminder[0].profileIds, ['karla', 'marvin']);
  assert.deepEqual(dueCalendarReminders(ctx.db, new Date('2026-04-11T15:59:59Z')), []);
  assert.deepEqual(dueCalendarReminders(ctx.db, new Date('2026-04-12T16:00:00Z')), []);
  const purchase = { action: 'shopping', version: 1, seriesVersion: 1 };
  const responses = await Promise.all([
    marvin.send('POST', pathTo + '2026-03-01', purchase),
    karla.send('POST', pathTo + '2026-03-01', purchase),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const [one, two] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(one.shoppingId, two.shoppingId);
  const { shopping } = await (await marvin.send('GET', '/state')).json();
  assert.equal(shopping.length, 1);
  assert.equal(shopping[0].category, 'household');
  assert.equal(shopping[0].title, 'Küchenpapier');
  assert.equal(shopping[0].createdBy, one.updatedBy);
  assert.deepEqual(dueCalendarReminders(ctx.db, dueAt), []);
  const skipped = await karla.send('POST', pathTo + '2026-02-01', { ...versions, action: 'skip' });
  assert.equal(skipped.status, 200);
  assert.equal(
    (
      await marvin.send('POST', pathTo + '2026-02-01', {
        version: 1,
        seriesVersion: 1,
        action: 'reopen',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await karla.send('POST', pathTo + '2026-02-01', {
        version: 2,
        seriesVersion: 1,
        action: 'done',
      })
    ).status,
    200,
  );
  assert.equal(
    (await karla.send('PATCH', '/calendar/' + series.id, { version: 1, archived: true })).status,
    200,
  );
  assert.equal(
    (
      await marvin.send('PATCH', '/calendar/' + series.id, {
        version: 1,
        title: 'Überholter Entwurf',
      })
    ).status,
    409,
  );
  assert.deepEqual(
    calendarOccurrences(
      await (await marvin.send('GET', '/calendar')).json(),
      '2026-01-01',
      '2026-12-31',
    ),
    [],
  );
  assert.equal(
    (await marvin.send('PATCH', '/calendar/' + series.id, { version: 2, archived: false })).status,
    200,
  );
  const garbage = await karla.send('POST', '/calendar', {
    ...input,
    title: 'Papiertonne',
    kind: 'waste',
    requestId: randomUUID(),
    everyWeeks: 2,
    remindDays: null,
  });
  assert.equal(garbage.status, 201);
  const garbageId = (await garbage.json()).id;
  assert.equal(
    (
      await karla.send('POST', '/calendar/' + garbageId + '/occurrences/2026-02-01', {
        ...versions,
        action: 'shopping',
      })
    ).status,
    409,
  );
  assert.deepEqual(dueCalendarReminders(ctx.db, new Date('2026-02-14T18:00:00Z')), []);
});

test('Verschieben und anschließendes Bearbeiten eines Einzeltermins behalten eine Erinnerung und den Einkaufsbezug', async (t) => {
  const { ctx, origin } = await testHousehold(t);
  const karla = await device(origin, 'karla');
  const marvin = await device(origin, 'marvin');
  const created = await karla.send('POST', '/calendar', {
    title: 'Seife',
    kind: 'household',
    startDay: '2026-02-10',
    everyWeeks: null,
    endDay: null,
    remindDays: 1,
    remindTime: '18:00',
    profileIds: ['karla', 'marvin'],
    requestId: randomUUID(),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const path = '/calendar/' + id;
  const actions = path + '/occurrences/';
  const original = '2026-02-10';
  const moved = '2026-02-11';
  const edited = '2026-02-12';
  assert.equal(
    (
      await marvin.send('POST', actions + original, {
        action: 'move',
        movedTo: moved,
        seriesVersion: 1,
        version: 0,
      })
    ).status,
    200,
  );
  assert.equal((await karla.send('PATCH', path, { startDay: edited, version: 1 })).status, 409);
  assert.equal((await karla.send('PATCH', path, { startDay: edited, version: 2 })).status, 200);
  const calendar: CalendarData = await (await marvin.send('GET', '/calendar')).json();
  assert.equal(calendar.series[0].startDay, edited);
  const visible = calendarOccurrences(calendar, original, '2026-02-28');
  assert.deepEqual(
    visible.map((row) => [row.day, row.originalDay]),
    [[edited, original]],
  );
  assert.deepEqual(dueCalendarReminders(ctx.db, new Date('2026-02-10T17:00:00Z')), []);
  const due = new Date('2026-02-11T17:00:00Z');
  assert.deepEqual(
    dueCalendarReminders(ctx.db, due).map((r) => [r.date, r.key]),
    [[edited, id + ':' + original]],
  );
  assert.deepEqual(
    openCalendarReminders(calendar, 'karla', due).map((r) => r.day),
    [edited],
  );
  assert.equal(
    (
      await marvin.send('POST', actions + moved, {
        action: 'skip',
        seriesVersion: 3,
        version: 0,
      })
    ).status,
    404,
  );
  const purchase = await karla.send('POST', actions + original, {
    action: 'shopping',
    seriesVersion: 3,
    version: visible[0].exception!.version,
  });
  assert.equal(purchase.status, 200);
  const checked = await purchase.json();
  assert.ok(checked.shoppingId);
  assert.deepEqual(dueCalendarReminders(ctx.db, due), []);
  assert.equal((await karla.send('PATCH', path, { everyWeeks: 1, version: 3 })).status, 200);
  const recurring = calendarOccurrences(
    await (await marvin.send('GET', '/calendar')).json(),
    original,
    '2026-02-20',
  );
  assert.deepEqual(
    recurring.map((r) => r.day),
    [edited, '2026-02-19'],
  );
  assert.equal(recurring[0].exception?.shoppingId, checked.shoppingId);
  assert.equal(recurring[0].exception?.status, 'done');
  assert.equal(recurring[1].exception, undefined);
  assert.equal(
    (
      await marvin.send('POST', actions + '2026-02-19', {
        action: 'move',
        movedTo: edited,
        seriesVersion: 4,
        version: 0,
      })
    ).status,
    200,
  );
  const both = calendarOccurrences(
    await (await marvin.send('GET', '/calendar')).json(),
    edited,
    edited,
  );
  assert.deepEqual(
    both.map((r) => r.originalDay),
    [edited, '2026-02-19'],
  );
  assert.equal((await karla.send('PATCH', path, { everyWeeks: null, version: 4 })).status, 200);
  const onceAgain = calendarOccurrences(
    await (await karla.send('GET', '/calendar')).json(),
    original,
    '2026-03-01',
  );
  assert.deepEqual(
    onceAgain.map((r) => [r.day, r.exception?.shoppingId]),
    [[edited, checked.shoppingId]],
  );
  assert.equal(
    (
      await marvin.send('POST', actions + '2026-02-19', {
        action: 'skip',
        seriesVersion: 5,
        version: 1,
      })
    ).status,
    404,
  );
});

test('Bestehende Einzeltermine mit alten Datumsaktionen zeigen einen Termin und bleiben bearbeitbar', async (t) => {
  const { ctx, origin } = await testHousehold(t);
  const karla = await device(origin, 'karla');
  const oldSeries = { ...example(), everyWeeks: null, startDay: '2026-02-12', version: 2 };
  const oldAction: CalendarOverride = {
    ...oldSeries,
    id: oldSeries.id + ':2026-02-10',
    seriesId: oldSeries.id,
    originalDay: '2026-02-10',
    movedTo: '2026-02-11',
    status: 'open',
    shoppingId: null,
    version: 1,
  };
  // So liegt ein Einzeltermin nach „Verschieben“ und „Eintrag bearbeiten“ in einer älteren Datenbank.
  ctx.db.put('calendar', oldSeries);
  ctx.db.put('calendarOverrides', oldAction);
  const due = new Date('2026-02-11T17:00:00Z');
  const legacyData = { series: [oldSeries], overrides: [oldAction] };
  assert.deepEqual(
    calendarOccurrences(legacyData, '2026-02-01', '2026-02-28').map((r) => r.day),
    [oldSeries.startDay],
  );
  const current: CalendarData = await (await karla.send('GET', '/calendar')).json();
  assert.deepEqual(
    openCalendarReminders(current, 'karla', due).map((r) => r.originalDay),
    [oldAction.originalDay],
  );
  assert.equal(dueCalendarReminders(ctx.db, due)[0].occurrenceVersion, oldAction.version);
  const path = '/calendar/' + oldSeries.id;
  assert.equal(
    (
      await karla.send('POST', path + '/occurrences/' + oldAction.originalDay, {
        action: 'done',
        version: oldAction.version,
        seriesVersion: oldSeries.version,
      })
    ).status,
    200,
  );
  assert.deepEqual(dueCalendarReminders(ctx.db, due), []);
  // Ein Altbestand mit einer passenden Verschiebung vor der ersten Serienbearbeitung behält den wirksamen Tag.
  ctx.db.put('calendar', { ...oldSeries, startDay: oldAction.originalDay } as CalendarSeries);
  const before = (await (await karla.send('GET', '/calendar')).json()) as CalendarData;
  assert.equal(before.series[0].startDay, oldAction.movedTo);
  assert.equal((await karla.send('PATCH', path, { title: 'Neuer Titel', version: 2 })).status, 200);
  const after = calendarOccurrences(
    await (await karla.send('GET', '/calendar')).json(),
    '2026-02-01',
    '2026-02-28',
  );
  assert.deepEqual(
    after.map((r) => [r.day, r.exception?.status]),
    [[oldAction.movedTo, 'done']],
  );
});
