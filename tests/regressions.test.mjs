import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';

// Load real service modules with an isolated database; no credentials or live data required.
async function load(path, db) {
  const cache = new Map();
  async function module(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const m = new vm.SourceTextModule(await readFile(url, 'utf8'), { identifier: url.href });
    cache.set(url.href, m);
    await m.link(async (specifier, parent) => {
      if (specifier === '../db.js') return new vm.SyntheticModule(['default'], function () { this.setExport('default', db); });
      if (specifier.endsWith('config.js')) return new vm.SyntheticModule(['config'], function () {
        this.setExport('config', { session: { cookieName: 'wtms_session' } });
      });
      if (specifier.startsWith('node:')) {
        const ns = await import(specifier);
        return new vm.SyntheticModule(Object.keys(ns), function () { for (const k of Object.keys(ns)) this.setExport(k, ns[k]); });
      }
      return module(new URL(specifier, parent.identifier));
    });
    return m;
  }
  const m = await module(new URL('../' + path, import.meta.url));
  await m.evaluate();
  return m.namespace;
}

function memoryDB() {
  const rows = [], idempotency = new Map(), locks = new Map(), context = new AsyncLocalStorage();
  const queryLog = [];
  async function lock(key) {
    const tx = context.getStore();
    assert.ok(tx, 'FOR UPDATE must run inside transaction');
    if (tx.keys.has(key)) return;
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const pending = new Promise(r => { release = r; });
    locks.set(key, previous.then(() => pending));
    await previous;
    tx.keys.add(key); tx.releases.push(release);
  }
  async function query(sql, p, kind) {
    sql = sql.replace(/\s+/g, ' ').trim(); queryLog.push(sql);
    if (sql.startsWith('SELECT id FROM users') && sql.endsWith('FOR UPDATE')) { await lock('user:' + p[0]); return { id: p[0] }; }
    if (sql.startsWith('SELECT id FROM api_keys')) { await lock('key:' + p[0]); return { id: p[0] }; }
    if (sql.includes('FROM sync_idempotency')) return idempotency.get(p[0]);
    if (sql.startsWith('SELECT id,owner_id,name FROM projects')) return { id: 1, owner_id: 2, name: '项目' };
    if (sql.startsWith('SELECT id,name,dept_id FROM users')) return { id: 4, name: '员工', dept_id: 1 };
    if (sql.includes('SUM(hours)')) {
      const n = rows.filter(r => r.user_id === Number(p[0]) && r.date === p[1] && r.id !== p[2]).reduce((s, r) => s + r.hours, 0);
      return { n, t: n };
    }
    if (sql.startsWith('SELECT status FROM timesheets')) return rows.filter(r => r.user_id === p[0] && r.date === p[1]).map(r => ({ status: r.status }));
    if (sql.includes('FROM project_members')) return { x: 1 };
    if (sql.startsWith('SELECT dept_id')) return { dept_id: 1 };
    if (sql.startsWith('INSERT INTO timesheets')) {
      const r = { id: rows.length + 1, user_id: p[0], dept_id: p[1], project_id: p[2], date: p[3], hours: p[4], content: p[5], status: sql.includes("'submitted'") ? 'submitted' : p[6] };
      rows.push(r); return { lastInsertRowid: r.id, changes: 1 };
    }
    if (sql.startsWith('INSERT IGNORE')) return { changes: 1 };
    if (sql.startsWith('INSERT INTO sync_idempotency')) { idempotency.set(p[0], { body_hash: p[2], response_body: p[4] }); return { changes: 1 }; }
    if (sql.startsWith('SELECT * FROM timesheets')) return { ...rows.find(r => r.id === p[0]) };
    if (sql.startsWith('SELECT t.*')) {
      if (sql.endsWith('FOR UPDATE')) await lock('record:' + p[0]);
      const row = rows.find(r => r.id === p[0]);
      return row && { ...row, owner_id: row.project_id === 1 ? 2 : 3 };
    }
    if (sql.startsWith('UPDATE timesheets SET project_id')) {
      await lock('record:' + p[8]);
      const row = rows.find(r => r.id === p[8]);
      if (row.status === 'approved') return { changes: 0 };
      Object.assign(row, { project_id: p[0], date: p[1], hours: p[2], content: p[3], status: p[4] }); return { changes: 1 };
    }
    if (sql.startsWith("UPDATE timesheets SET status='approved'")) {
      assert.ok(context.getStore().keys.has('record:' + p[3]));
      const row = rows.find(r => r.id === p[3]);
      if (row.status !== 'submitted') return { changes: 0 };
      row.status = 'approved'; return { changes: 1 };
    }
    throw Error('Unhandled ' + kind + ': ' + sql);
  }
  return { rows, queryLog, prepare: sql => Object.fromEntries(['get', 'all', 'run'].map(kind => [kind, (...p) => query(sql, p, kind)])),
    transaction: fn => (...args) => context.run({ keys: new Set(), releases: [] }, async () => {
      try { return await fn(...args); } finally { context.getStore().releases.reverse().forEach(r => r()); }
    }) };
}
const payload = { projectId: 1, date: '2026-01-12', hours: 13, content: '任务', submit: true };
const batch = { project: { projectId: 1 }, records: [{ username: 'dev1', date: payload.date, hours: 13 }] };

test('role endpoints enforce first-password gate and retain normal authorization', async () => {
  const { requireRole } = await load('src/middleware/auth.js', {});
  for (const [user, code] of [[null, 'UNAUTHORIZED'], [{ role: 'admin', mustChangePassword: true }, 'FORBIDDEN'], [{ role: 'dev' }, 'FORBIDDEN'], [{ role: 'admin' }, undefined]]) {
    let result; requireRole('admin')({ user }, {}, e => { result = e?.code; }); assert.equal(result, code);
  }
});

test('concurrent web creates cannot exceed 24h', async () => {
  const db = memoryDB(), svc = await load('src/services/timesheetService.js', db);
  const results = await Promise.allSettled([svc.create({ id: 4 }, payload), svc.create({ id: 4 }, payload)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'HOURS_EXCEEDED'); assert.equal(db.rows.length, 1);
});

test('web and WPS writes share the same daily limit lock', async () => {
  const db = memoryDB(), web = await load('src/services/timesheetService.js', db), wps = await load('src/services/integrationService.js', db);
  const results = await Promise.allSettled([web.create({ id: 4 }, payload), wps.syncWorkHours({ id: 1 }, batch, 'batch')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(db.rows.length, 1);
});

test('identical WPS retries replay success before checking accumulated hours', async () => {
  const db = memoryDB(), svc = await load('src/services/integrationService.js', db);
  await svc.syncWorkHours({ id: 1 }, batch, 'batch');
  const replay = await svc.syncWorkHours({ id: 1 }, batch, 'batch');
  assert.equal(replay.duplicate, true); assert.equal(replay.accepted, 1); assert.equal(db.rows.length, 1);
  await assert.rejects(svc.syncWorkHours({ id: 1 }, { ...batch, records: [{ ...batch.records[0], hours: 14 }] }, 'batch'), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('simultaneous retries insert only once', async () => {
  const db = memoryDB(), svc = await load('src/services/integrationService.js', db);
  const results = await Promise.all([svc.syncWorkHours({ id: 1 }, batch, 'batch'), svc.syncWorkHours({ id: 1 }, batch, 'batch')]);
  assert.equal(results.filter(r => r.duplicate).length, 1); assert.equal(db.rows.length, 1);
});

test('moving to another project and auditing cannot approve with stale project permission', async () => {
  const db = memoryDB(), svc = await load('src/services/timesheetService.js', db);
  await svc.create({ id: 4 }, payload);
  const results = await Promise.allSettled([
    svc.update({ id: 4 }, 1, { ...payload, projectId: 2 }),
    svc.audit({ id: 2, role: 'pm' }, 1, 'approve'),
  ]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.ok(!(db.rows[0].project_id === 2 && db.rows[0].status === 'approved'));
});

test('statistics retain former members, sort by maintained order and reconcile totals', async () => {
  const db = { prepare: sql => ({ get: async () => ({ name: '项目', owner_id: 2 }), all: async () => {
    if (sql.includes('date >')) return [];
    if (sql.includes('SELECT t.user_id')) return [{ user_id: 4, date: payload.date, hours: 7 }];
    if (sql.includes('DISTINCT user_id')) return [{ user_id: 2 }, { user_id: 5 }];
    if (sql.includes('SELECT u.id')) return [{ id: 2, name: '负责人', sort_order: 20 }, { id: 4, name: '历史成员', sort_order: 10 }, { id: 5, name: '成员', sort_order: 10 }];
    throw Error(sql);
  } }) };
  const svc = await load('src/services/statsService.js', db), stats = await svc.projectStats(1, '2026-01', 'approved', [1]);
  assert.deepEqual(Array.from(stats.memberRows, r => r.userId), [4, 5, 2]);
  assert.equal(stats.memberRows.reduce((s, r) => s + r.sum, 0), stats.grand); assert.equal(stats.grand, 7);
});

for (const [action, submitted] of [['add-submit', true], ['add-save', false]]) {
  test('monthly day editor handles ' + action, async () => {
    let handler; const writes = [], messages = [];
    const body = { innerHTML: '', addEventListener: (_, fn) => { handler = fn; } };
    const context = vm.createContext({ state: { user: { id: 4 } }, weekdayOf: () => '一', esc: String, opt: () => '', fmtH: String,
      openModal: () => ({ querySelector: () => body }), toast: (...args) => messages.push(args), checkHoursRule: async () => true,
      api: { get: async path => path.startsWith('/api/projects') ? [{ id: 1, name: '项目' }] : [], post: async (...args) => writes.push(args) } });
    vm.runInContext(await readFile(new URL('../public/js/views-monthly.js', import.meta.url), 'utf8'), context);
    await context.openDayEditor(payload.date);
    const card = { classList: { contains: name => name === 'add-card' }, querySelector: selector => ({ value: selector.includes('project') ? '1' : selector.includes('hours') ? '7' : '任务' }) };
    const button = { dataset: { act: action }, closest: () => card };
    await handler({ target: { closest: () => button } });
    assert.equal(writes.length, 1); assert.equal(writes[0][0], '/api/timesheets'); assert.equal(writes[0][1].submit, submitted);
    assert.equal(messages[0][1], undefined);
  });
}
