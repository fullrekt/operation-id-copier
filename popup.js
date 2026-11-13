import { scanOperationIds, formatIds } from "./collector.mjs";

const collect = document.querySelector("#collect");
const database = document.querySelector("#database");
const status = document.querySelector("#status");

function setStatus(message, state = "") {
  // Details stay in the tooltip and screen-reader announcement.
  collect.title = message;
  collect.dataset.state = state;
  status.textContent = message;
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Compatibility fallback when the async Clipboard API is unavailable.
    const field = document.createElement("textarea");
    field.value = text;
    field.className = "sr-only";
    field.setAttribute("aria-hidden", "true");
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand("copy"); }
    finally { field.remove(); collect.focus(); }
    if (!copied) throw new Error("Clipboard unavailable");
  }
}

collect.addEventListener("click", async () => {
  collect.disabled = true;
  collect.setAttribute("aria-busy", "true");
  setStatus("Собираю operation_id…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    database.disabled = true;
    if (!tab?.id) throw new Error("No active tab");
    const responses = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanOperationIds
    });
    const data = responses[0]?.result;
    if (!data || !Array.isArray(data.ids)) throw new Error("No page result");
    const warning = data.inaccessibleFrames
      ? " Часть встроенных блоков недоступна: открой их отдельной вкладкой для сбора ID."
      : "";
    if (!data.ids.length) {
      setStatus("operation_id не найдены. Открой заметки или описание обращения и повтори сбор." + warning, "error");
      return;
    }
    try {
      await writeClipboard(formatIds(data.ids));
      await chrome.storage.session.set({ ["selection:" + tab.id]: { ids: data.ids, url: tab.url, inaccessibleFrames: data.inaccessibleFrames } });
      setStatus(`Скопировано ID: ${data.ids.length}` + warning, data.inaccessibleFrames ? "error" : "success");
    } catch {
      setStatus("Браузер запретил копирование. Проверь разрешения расширения и повтори попытку.", "error");
    }
  } catch {
    setStatus("Нет доступа к странице. Открой обращение. Для локального HTML включи «Разрешить доступ к URL файлов» в настройках расширения.", "error");
  } finally {
    collect.disabled = false;
    database.disabled = false;
    collect.removeAttribute("aria-busy");
  }
});


database.addEventListener("click", async () => {
  database.disabled = true;
  collect.disabled = true;
  database.setAttribute("aria-busy", "true");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Открой вкладку с обращением.");
    const key = "selection:" + tab.id;
    const stored = (await chrome.storage.session.get(key))[key];
    let data = stored?.url === tab.url ? stored : null;
    if (!data) {
      const responses = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanOperationIds });
      data = responses[0]?.result;
    }
    if (!data?.ids?.length) throw new Error("operation_id не найдены. Открой заметки обращения.");
    if (data.inaccessibleFrames) throw new Error("Часть встроенных блоков недоступна. Открой блок с ID отдельной вкладкой.");
    if (data.ids.length > 2000) throw new Error("За один запрос можно проверить до 2000 ID.");
    const requestId = crypto.randomUUID();
    const all = await chrome.storage.session.get(null);
    const previous = Object.keys(all).filter(key => key.startsWith("request:")).sort((a,b) => all[a].createdAt - all[b].createdAt);
    if (previous.length >= 20) await chrome.storage.session.remove(previous.slice(0, previous.length - 19));
    await chrome.storage.session.set({ ["request:" + requestId]: { ids: data.ids, createdAt: Date.now() } });
    await chrome.tabs.create({ url: chrome.runtime.getURL("results.html?request=" + requestId) });
    database.title = "Результат открыт в отдельной вкладке.";
    database.dataset.state = "success";
  } catch (error) {
    database.title = error.message;
    database.dataset.state = "error";
    status.textContent = error.message;
  } finally {
    database.disabled = false;
    collect.disabled = false;
    database.removeAttribute("aria-busy");
  }
});


document.querySelector("#connect").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
});
