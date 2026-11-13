import { readFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApi } from './api.mjs';

const configPath = fileURLToPath(new URL('./.local/config.json', import.meta.url));
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
  chmodSync(configPath, 0o600);
  if (!config.host || !config.database || !config.extensionId || !config.token) throw new Error();
} catch {
  console.error('Сначала запусти «Настроить БД.command» и введи параметры подключения.');
  process.exit(1);
}
const configured = Boolean(config.user && config.password && config.sslMode);
if (configured && !['verify-full', 'disable'].includes(config.sslMode)) {
  console.error('В настройке SSL выбери verify-full или disable.');
  process.exit(1);
}
const ssl = !configured || config.sslMode === 'disable' ? false : {
  rejectUnauthorized: true,
  ...(config.caFile ? { ca: readFileSync(config.caFile, 'utf8') } : {})
};
// Preserve PostgreSQL date text and numeric precision in the result table.
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, value => value);
const pool = new pg.Pool({
  host: config.host, port: config.port, database: config.database,
  user: config.user, password: config.password, ssl,
  max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
  statement_timeout: 15000, application_name: 'operation-id-copier'
});
pool.on('error', () => console.error('Соединение с PostgreSQL прервано. Проверь VPN.'));
const safePool = { connect: async () => {
  if (!configured) throw Object.assign(new Error('Database configuration required'), { code: 'CONFIG_MISSING' });
  return pool.connect();
} };
const server = createApi({ pool: safePool, token: config.token, extensionId: config.extensionId, schema: config.schema || 'public' });
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Порт 17879 уже занят. Возможно, сервис уже запущен.' : 'Не удалось запустить локальный сервис.');
  pool.end().finally(() => process.exit(1));
});
server.listen(17879, '127.0.0.1', () => {
  console.log('Сервис БД работает: http://127.0.0.1:17879');
  console.log(configured ? 'Подключение настроено. Запросы выполняются по нажатию кнопки расширения.' : 'БД ещё не настроена. Запусти «Настроить БД.command» и введи логин и пароль.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close();
  pool.end().finally(() => process.exit(0));
});
