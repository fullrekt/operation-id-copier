// Self-contained: Chrome serializes this function before injecting it into a tab.
export function scanOperationIds() {
  const ids = [];
  const seen = new Set();
  const documents = new WeakSet();
  let inaccessibleFrames = 0;

  // Whitespace is allowed even inside groups: editors may split UUIDs into spans
  // or insert line breaks. Invisible word-break characters are removed below.
  const group = (length) => `[a-f0-9](?:\\s*[a-f0-9]){${length - 1}}`;
  const uuid = [8, 4, 4, 4, 12].map(group).join("\\s*-\\s*");
  const pattern = new RegExp(
    `\\boperation[\\s_-]*id\\b["']?\\s*[:=]?\\s*["']?\\s*(${uuid})(?![a-f0-9-])`,
    "gi"
  );
  function extract(text) {
    const normalized = text
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/[\u2010-\u2014\u2212]/g, "-");
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const id = match[1].replace(/\s/g, "").toLowerCase();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  function scan(doc) {
    if (!doc || documents.has(doc)) return;
    documents.add(doc);
    const view = doc.defaultView;
    if (!view || !doc.body) return;
    let buffer = "";
    const flush = () => { extract(buffer); buffer = ""; };
    const excluded = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

    function walk(node) {
      if (node.nodeType === 3) { buffer += node.nodeValue; return; }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.nodeType === 11) {
        for (const child of node.childNodes) walk(child);
        return;
      }
      if (excluded.has(node.tagName) || node.hidden) return;
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return;
      if (node.tagName === "IFRAME" || node.tagName === "FRAME") {
        flush();
        try {
          const child = node.contentDocument;
          if (child?.body) scan(child);
          else inaccessibleFrames++;
        } catch { inaccessibleFrames++; }
        return;
      }
      if (node.tagName === "TEXTAREA" ||
          (node.tagName === "INPUT" && ["text", "search"].includes(node.type))) {
        flush();
        const value = node.value || "";
        // Some editors expose their HTML in a textarea while in source mode.
        if (/<[a-z][\s\S]*>/i.test(value)) {
          const parsed = new view.DOMParser().parseFromString(value, "text/html");
          for (const el of parsed.querySelectorAll("script, style, template")) el.remove();
          for (const br of parsed.querySelectorAll("br")) br.replaceWith("\n");
          extract(parsed.body.textContent || "");
        } else extract(value);
        return;
      }
      if (node.tagName === "BR") { buffer += "\n"; return; }
      const boundary = !["inline", "contents", "inline-block"].includes(style.display);
      if (boundary) buffer += "\n";
      if (node.shadowRoot) walk(node.shadowRoot);
      else if (node.tagName === "SLOT" && node.assignedNodes().length) {
        for (const child of node.assignedNodes()) walk(child);
      } else {
        for (const child of node.childNodes) walk(child);
      }
      if (boundary) buffer += "\n";
    }
    walk(doc.body);
    flush();
  }
  scan(document);
  return { ids, inaccessibleFrames };
}

export function formatIds(ids) {
  if (!ids.length) return "";
  return `(\n${ids.map((id) => `    '${id}'`).join(",\n")}\n)`;
}
