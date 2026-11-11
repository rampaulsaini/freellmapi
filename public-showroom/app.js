(() => {
  const config = window.SHOWROOM_CONFIG || {};
  const base = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.replace(/\/+$/, "") : "";
  const status = document.getElementById("status");
  const recordsEl = document.getElementById("records");
  const kindFilter = document.getElementById("kind-filter");
  const previous = document.getElementById("previous");
  const next = document.getElementById("next");
  const pageLabel = document.getElementById("page-label");
  const pageSize = 24;
  let offset = 0;
  let total = 0;

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? "" : String(value);
    return node;
  };

  function renderRecord(record) {
    const article = text("article", "record", "");
    const top = text("div", "record-top", "");
    top.append(text("span", "kind", record.kind || "record"));
    top.append(text("span", "verified", "सिस्टम में verified"));
    article.append(top);
    article.append(text("h3", "", record.name || "बिना नाम का रिकॉर्ड"));
    if (record.description) article.append(text("p", "", record.description));
    const meta = text("div", "meta", "");
    const license = text("div", "", "");
    license.append(text("strong", "", "घोषित लाइसेंस: "));
    license.append(document.createTextNode(record.license || "उपलब्ध नहीं"));
    meta.append(license);
    if (record.sourceName) {
      const source = text("div", "", "");
      source.append(text("strong", "", "स्रोत: "));
      source.append(document.createTextNode(record.sourceName));
      meta.append(source);
    }
    if (record.sourceUrl && /^https:\/\//i.test(record.sourceUrl)) {
      const link = document.createElement("a");
      link.href = record.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "मूल स्रोत खोलें ↗";
      meta.append(link);
    }
    article.append(meta);
    return article;
  }

  async function load() {
    if (!base || !/^https:\/\//i.test(base)) {
      status.textContent = "कैटलॉग API अभी कॉन्फ़िगर नहीं है। यह प्रदर्शन पृष्ठ तैयार है, लेकिन वास्तविक रिकॉर्ड उपलब्ध नहीं कराए जा रहे हैं।";
      recordsEl.replaceChildren(text("div", "empty", "API जुड़ने और वास्तविक रिकॉर्ड की जाँच होने तक यहाँ कोई उत्पाद सूचीबद्ध नहीं है।"));
      previous.disabled = true; next.disabled = true; pageLabel.textContent = "—";
      return;
    }
    status.textContent = "रिकॉर्ड लोड हो रहे हैं…";
    recordsEl.replaceChildren();
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (kindFilter.value) params.set("kind", kindFilter.value);
    try {
      const response = await fetch(base + "/api/showroom/records?" + params.toString(), {
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      if (!Array.isArray(payload.records) || !payload.page) throw new Error("Invalid catalogue response");
      total = Number(payload.page.total) || 0;
      for (const record of payload.records) recordsEl.append(renderRecord(record));
      if (!payload.records.length) recordsEl.append(text("div", "empty", "इस श्रेणी में अभी कोई पात्र सार्वजनिक रिकॉर्ड उपलब्ध नहीं है।"));
      status.textContent = total ? total + " पात्र कैटलॉग रिकॉर्ड" : "अभी कोई पात्र सार्वजनिक रिकॉर्ड उपलब्ध नहीं है।";
      previous.disabled = offset <= 0;
      next.disabled = offset + pageSize >= total;
      pageLabel.textContent = total ? (offset + 1) + "–" + Math.min(offset + pageSize, total) + " / " + total : "0 रिकॉर्ड";
    } catch (error) {
      status.textContent = "कैटलॉग अभी उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें।";
      recordsEl.replaceChildren(text("div", "empty", "सर्वर से सुरक्षित प्रतिक्रिया प्राप्त नहीं हुई।"));
      previous.disabled = true; next.disabled = true; pageLabel.textContent = "—";
    }
  }

  kindFilter.addEventListener("change", () => { offset = 0; load(); });
  previous.addEventListener("click", () => { offset = Math.max(0, offset - pageSize); load(); });
  next.addEventListener("click", () => { if (offset + pageSize < total) { offset += pageSize; load(); } });
  load();
})();