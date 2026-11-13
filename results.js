import { COLUMNS, fetchStock } from './db-client.mjs';
import { formatIds } from './collector.mjs';

const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
const result = document.querySelector('#result');
const rowsElement = document.querySelector('#rows');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const requestId = new URL(location.href).searchParams.get('request');
let rows = [], page = 0;
const pageSize = 200;
for (const name of ['№', ...COLUMNS]) {
  const th = document.createElement('th'); th.scope = 'col'; th.textContent = name;
  if (name === '№') { th.className = 'row-number'; th.setAttribute('aria-label', 'Номер строки'); }
  document.querySelector('#columns').append(th);
}

function renderPage() {
  rowsElement.replaceChildren();
  const fragment = document.createDocumentFragment();
  const start = page * pageSize;
  for (const [offset, row] of rows.slice(start, start + pageSize).entries()) {
    const tr = document.createElement('tr');
    const number = document.createElement('th');
    number.scope = 'row';
    number.className = 'row-number';
    number.textContent = String(start + offset + 1);
    tr.append(number);
    for (const value of row) {
      const td = document.createElement('td');
      td.textContent = value == null ? 'NULL' : String(value);
      if (value == null) td.className = 'null';
      tr.append(td);
    }
    fragment.append(tr);
  }
  rowsElement.append(fragment);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  document.querySelector('#page-label').textContent = `${page + 1} / ${pages}`;
  previous.disabled = page === 0;
  next.disabled = page + 1 >= pages;
  document.querySelector('nav').hidden = pages === 1;
  document.querySelector('.table-scroll').scrollTop = 0;
}

async function load() {
  refresh.disabled = true;
  result.hidden = true;
  document.querySelector('#missing').hidden = true;
  status.dataset.state = '';
  status.textContent = 'Выполняю SELECT…';
  try {
    if (!requestId || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Нет списка ID. Нажми «Проверить в БД» на странице обращения.');
    const key = 'request:' + requestId;
    const request = (await chrome.storage.session.get(key))[key];
    if (!request?.ids?.length) throw new Error('Список ID больше недоступен. Повтори сбор на странице обращения.');
    document.querySelector('#sql').textContent = `select ${COLUMNS.join(', ')}\nfrom report_stock rs\nwhere operation_id in ${formatIds(request.ids)}`;
    document.querySelector('#sql-detail').hidden = false;
    const data = await fetchStock(request.ids);
    rows = data.rows; page = 0;
    const suffix = data.truncated ? ` Показаны первые ${data.limit} строк: результат ограничен, проверка отсутствующих ID не выполнялась.` : '';
    status.textContent = `Отправлено ID: ${data.requestedCount}. Найдено строк: ${rows.length}.` + suffix;
    status.dataset.state = data.truncated ? 'error' : 'success';
    if (rows.length) { result.hidden = false; renderPage(); }
    else status.textContent = `Для отправленных ID строк в report_stock не найдено. Проверено ID: ${data.requestedCount}.`;
    if (data.missingIds?.length) {
      document.querySelector('#missing-ids').textContent = data.missingIds.join('\n');
      document.querySelector('#missing').hidden = false;
    }
  } catch (error) {
    status.textContent = error.message;
    status.dataset.state = 'error';
  } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', load);
previous.addEventListener('click', () => { if (page > 0) { page--; renderPage(); } });
next.addEventListener('click', () => { if ((page + 1) * pageSize < rows.length) { page++; renderPage(); } });
load();
