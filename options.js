const token = document.querySelector('#token');
const status = document.querySelector('#status');
document.querySelector('#extension-id').value = chrome.runtime.id;
if (chrome.storage?.local) {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  token.value = (await chrome.storage.local.get('bridgeToken')).bridgeToken || '';
} else {
  status.textContent = 'Нужно перезагрузить установленное расширение: открой chrome://extensions, найди Operation ID и нажми «Перезагрузить». Затем открой «Подключение» заново.';
  status.dataset.state = 'error';
  document.querySelector('button[type=submit]').disabled = true;
}
document.querySelector('#settings').addEventListener('submit', async event => {
  event.preventDefault();
  const value = token.value.trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    status.textContent = 'Вставь ключ из окна настройки: 64 символа.';
    status.dataset.state = 'error'; return;
  }
  try {
    await chrome.storage.local.set({ bridgeToken: value });
    status.textContent = 'Ключ сохранён. Запусти локальный сервис и нажми «Повторить запрос» во вкладке результата.';
    status.dataset.state = 'success';
  } catch {
    status.textContent = 'Не удалось сохранить ключ. Проверь настройки браузера.';
    status.dataset.state = 'error';
  }
});
