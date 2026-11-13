import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, buildQuery, COLUMNS } from './api.mjs';

const ID = '40ecba4d-05e3-44dc-a65b-2dcebbe2477d';
const SECOND = '6280f368-ef7d-4799-9502-a2c601a3b777';
const extensionId = 'a'.repeat(32), token = 'f'.repeat(64);

async function fixture(t, result = { rows: [] }, options = {}) {
  const calls = [], releases = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === 'object') {
        if (result instanceof Error) throw result;
        return result;
      }
      return { rows: [] };
    },
    release(broken) { releases.push(broken); }
  };
  const server = createApi({ pool: { connect: async () => client }, token, extensionId, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (payload, headers = {}, method = 'POST') => fetch(base + '/query', {
    method,
    headers: { Origin: `chrome-extension://${extensionId}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(method !== 'OPTIONS' ? { body: JSON.stringify(payload) } : {})
  });
  return { calls, releases, request };
}

test('UUIDs are validated and passed as bound parameters; schema is validated', () => {
  const query = buildQuery([ID, ID.toUpperCase(), SECOND], 'public', 100);
  assert.equal(query.text.includes(ID), false);
  assert.match(query.text, /where operation_id in \(\$1, \$2\)/);
  assert.deepEqual(query.values, [ID, SECOND, 101]);
  assert.throws(() => buildQuery(["'); DROP TABLE report_stock; --"], 'public', 100));
  assert.throws(() => buildQuery([ID], 'public";drop schema public;--', 100));
  assert.throws(() => buildQuery([], 'public', 100));
  assert.throws(() => buildQuery(Array(2001).fill(ID), 'public', 100));
});

test('request requires both the allowed extension origin and token', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ ids: [ID] }, { Authorization: 'Bearer wrong' })).status, 401);
  const web = await f.request({ ids: [ID] }, { Origin: 'https://example.com' });
  assert.equal(web.status, 403);
  assert.equal(web.headers.get('access-control-allow-origin'), null);
  assert.equal((await f.request({ ids: [ID] }, { Origin: '' })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('invalid IDs and arbitrary SQL are rejected before opening a DB connection', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ ids: ["'; select 1 --"] })).status, 400);
  assert.equal((await f.request({ ids: [ID], sql: 'delete from report_stock' })).status, 400);
  assert.equal((await f.request(null)).status, 400);
  assert.equal(f.calls.length, 0);
});

test('SELECT uses READ ONLY, timeouts and bound parameters; missing IDs are reported', async t => {
  const row = [ID, 264, 'address', 'product', '999999999999999.1234', 'type', null, 'ref', '2026-10-22 12:00:00+03'];
  const f = await fixture(t, { rows: [row] });
  const response = await f.request({ ids: [ID, SECOND] });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.columns, COLUMNS);
  assert.deepEqual(data.rows, [row]);
  assert.deepEqual(data.missingIds, [SECOND]);
  assert.equal(data.requestedCount, 2);
  assert.equal(f.calls[0], 'BEGIN READ ONLY');
  assert.match(f.calls[1], /statement_timeout/);
  assert.match(f.calls[2], /lock_timeout/);
  assert.equal(f.calls.at(-1), 'COMMIT');
  assert.deepEqual(f.calls[3].values, [ID, SECOND, 10001]);
  assert.deepEqual(f.releases, [false]);
});

test('DB errors roll back and do not expose credentials or server diagnostics', async t => {
  const f = await fixture(t, Object.assign(new Error('password secret at internal-host'), { code: '28P01' }));
  const response = await f.request({ ids: [ID] });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /логин или пароль/);
  assert.doesNotMatch(body, /secret|internal-host/);
  assert.equal(f.calls.at(-1), 'ROLLBACK');
  assert.deepEqual(f.releases, [false]);
});

test('limited result is explicitly flagged and does not falsely report missing IDs', async t => {
  const f = await fixture(t, { rows: [[ID], [ID], [ID]] }, { maxRows: 2 });
  const data = await (await f.request({ ids: [ID, SECOND] })).json();
  assert.equal(data.rows.length, 2);
  assert.equal(data.truncated, true);
  assert.deepEqual(data.missingIds, []);
});

test('preflight is handled without accessing PostgreSQL', async t => {
  const f = await fixture(t);
  const response = await f.request(null, {}, 'OPTIONS');
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), `chrome-extension://${extensionId}`);
  assert.equal(f.calls.length, 0);
});
