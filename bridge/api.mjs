import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const COLUMNS = ['operation_id', 'location_id', 'address_id', 'product_id', 'quantity_delta', 'operation_type', 'motive', 'reference', 'operation_date'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const MAX_IDS = 2000;

export function buildQuery(ids, schema, maxRows) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new Error(`Нужен список от 1 до ${MAX_IDS} корректных operation_id.`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Некорректная схема БД.');
  const values = [...new Set(ids.map(id => id.toLowerCase()))];
  const text = `select ${COLUMNS.join(', ')}\nfrom "${schema}"."report_stock" rs\nwhere operation_id in (${values.map((_, i) => `$${i + 1}`).join(', ')})\nlimit $${values.length + 1}`;
  return { text, values: [...values, maxRows + 1], rowMode: 'array' };
}

function authorized(header, token) {
  const actual = Buffer.from(header || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function databaseError(code) {
  if (code === 'CONFIG_MISSING') return 'Сначала запусти «Настроить БД.command» и введи логин и пароль PostgreSQL.';
  if (code === '28P01' || code === '28000') return 'БД отклонила логин или пароль. Запусти настройку подключения ещё раз.';
  if (code === '42501') return 'У пользователя БД нет доступа к таблице report_stock.';
  if (code === '42P01' || code === '3F000') return 'Таблица report_stock не найдена. Проверь базу и схему подключения.';
  if (code === '42703') return 'В report_stock нет одного из запрошенных столбцов.';
  if (code === '57014' || code === '55P03') return 'Запрос превысил время ожидания. Попробуй позже или сократи список ID.';
  return 'Не удалось прочитать PostgreSQL. Проверь VPN, параметры подключения и SSL.';
}

export function createApi({ pool, token, extensionId, schema = 'public', maxRows = 10000, timeoutMs = 15000 }) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Укажи ID расширения из chrome://extensions.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Ключ подключения слишком короткий.');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 50000) throw new Error('Некорректный лимит строк.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Некорректный таймаут.');
  buildQuery(['00000000-0000-0000-0000-000000000000'], schema, maxRows);
  const origin = `chrome-extension://${extensionId}`;
  let active = 0;
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    const address = server.address();
    if (req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin !== origin) {
      respond(403, { error: 'Источник запроса не разрешён.' }); return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS' && req.url === '/query') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204); res.end(); return;
    }
    if (req.url !== '/query' || req.method !== 'POST') { respond(404, { error: 'Маршрут не найден.' }); return; }
    if (!authorized(req.headers.authorization, token)) { respond(401, { error: 'Неверный ключ подключения. Проверь настройки расширения.' }); return; }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { respond(415, { error: 'Ожидается JSON.' }); return; }
    if (active >= 2) { respond(429, { error: 'Уже выполняются два запроса. Дождись завершения.' }); return; }
    active++;
    let client;
    let broken = false;
    try {
      const body = await new Promise((resolve, reject) => {
        let text = '', size = 0, oversized = false;
        req.on('data', chunk => {
          size += chunk.length;
          if (size > 256 * 1024) oversized = true;
          if (!oversized) text += chunk.toString('utf8');
        });
        req.on('end', () => oversized ? reject(Object.assign(new Error('Слишком большой запрос.'), { status: 413 })) : resolve(text));
        req.on('error', reject);
        req.on('aborted', () => reject(new Error('Запрос прерван.')));
      });
      let query;
      try {
        const payload = JSON.parse(body);
        if (!payload || Object.keys(payload).some(key => key !== 'ids')) throw new Error('Допускается только список ids.');
        query = buildQuery(payload.ids, schema, maxRows);
      } catch (error) { respond(400, { error: error.message }); return; }
      client = await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      await client.query("SET LOCAL lock_timeout = '3s'");
      const data = await client.query(query);
      await client.query('COMMIT');
      const rows = data.rows.slice(0, maxRows);
      const found = new Set(rows.map(row => String(row[0]).toLowerCase()));
      const requested = query.values.slice(0, -1);
      const truncated = data.rows.length > maxRows;
      respond(200, { columns: COLUMNS, rows, requestedCount: requested.length, missingIds: truncated ? [] : requested.filter(id => !found.has(id)), truncated, limit: maxRows });
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch { broken = true; }
      }
      if (error.status === 413) respond(413, { error: error.message });
      else respond(502, { error: databaseError(error.code) });
    } finally {
      client?.release(broken);
      active--;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
