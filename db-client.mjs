export const COLUMNS = ['operation_id', 'location_id', 'address_id', 'product_id', 'quantity_delta', 'operation_type', 'motive', 'reference', 'operation_date'];

export async function fetchStock(ids) {
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  if (!bridgeToken) throw new Error('Сначала открой «Подключение» и сохрани ключ локального сервиса.');
  let response;
  try {
    response = await fetch('http://127.0.0.1:17879/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bridgeToken}` },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(25000),
      cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Сервис не ответил вовремя. Проверь VPN и повтори запрос.');
    throw new Error('Локальный сервис недоступен. Запусти «Запустить БД.command» и проверь VPN.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Локальный сервис вернул некорректный ответ.'); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Ошибка локального сервиса.');
  if (!Array.isArray(data.columns) || data.columns.join('|') !== COLUMNS.join('|') || !Array.isArray(data.rows) || data.rows.some(row => !Array.isArray(row) || row.length !== COLUMNS.length)) {
    throw new Error('В ответе сервиса отсутствуют ожидаемые столбцы.');
  }
  return data;
}
