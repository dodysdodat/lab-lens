(function () {
  const STORAGE_KEY = "labLensInventory.v1";
  const DAY_MS = 24 * 60 * 60 * 1000;

  const seedInventory = [
    {
      manufacturer: "Acme Diagnostics",
      materialNumber: "GLU-1200",
      lotNumber: "A24-771",
      expirationDate: nextDate(22),
      quantity: 18,
      target: 25,
      updatedAt: new Date().toISOString()
    },
    {
      manufacturer: "Northstar Medical",
      materialNumber: "SAL-090",
      lotNumber: "NS-5521",
      expirationDate: nextDate(180),
      quantity: 42,
      target: 30,
      updatedAt: new Date().toISOString()
    }
  ];

  let inventory = loadInventory();

  const forms = {
    receive: document.getElementById("receiveForm"),
    discard: document.getElementById("discardForm"),
    verify: document.getElementById("verifyForm"),
    target: document.getElementById("targetForm")
  };

  const selects = [
    forms.discard.elements.itemKey,
    forms.verify.elements.itemKey,
    forms.target.elements.itemKey
  ];

  const inventoryList = document.getElementById("inventoryList");
  const orderList = document.getElementById("orderList");
  const itemTemplate = document.getElementById("itemTemplate");
  const searchInput = document.getElementById("searchInput");
  const parseOtcBtn = document.getElementById("parseOtcBtn");
  const labelPhotoInput = document.getElementById("labelPhotoInput");
  const labelPhotoPreview = document.getElementById("labelPhotoPreview");
  const photoPreview = document.getElementById("photoPreview");
  const extractLabelBtn = document.getElementById("extractLabelBtn");
  const extractionStatus = document.getElementById("extractionStatus");
  let previewUrl = "";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  forms.receive.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formValues(forms.receive);
    const quantity = numberFrom(data.quantity);
    const target = data.target === "" ? null : numberFrom(data.target);

    if (quantity <= 0) {
      toast("Received quantity must be at least 1.");
      return;
    }

    const existing = findItem(data);
    if (existing) {
      existing.quantity += quantity;
      if (target !== null) existing.target = target;
      existing.updatedAt = new Date().toISOString();
    } else {
      inventory.push({
        manufacturer: clean(data.manufacturer),
        materialNumber: clean(data.materialNumber),
        lotNumber: clean(data.lotNumber),
        expirationDate: data.expirationDate,
        quantity,
        target: target || 0,
        updatedAt: new Date().toISOString()
      });
    }

    saveAndRender();
    forms.receive.reset();
    clearPhotoCapture();
    toast("Supply received and total quantity updated.");
  });

  forms.discard.addEventListener("submit", (event) => {
    event.preventDefault();
    const item = itemByKey(forms.discard.elements.itemKey.value);
    const quantity = numberFrom(forms.discard.elements.quantity.value);

    if (!item) {
      toast("Select an inventory lot first.");
      return;
    }

    if (quantity <= 0) {
      toast("Discard quantity must be at least 1.");
      return;
    }

    item.quantity = Math.max(0, item.quantity - quantity);
    item.updatedAt = new Date().toISOString();
    saveAndRender();
    forms.discard.reset();
    toast("Quantity discarded.");
  });

  forms.verify.addEventListener("submit", (event) => {
    event.preventDefault();
    const item = itemByKey(forms.verify.elements.itemKey.value);
    const quantity = numberFrom(forms.verify.elements.quantity.value);

    if (!item) {
      toast("Select an inventory lot first.");
      return;
    }

    item.quantity = Math.max(0, quantity);
    item.updatedAt = new Date().toISOString();
    saveAndRender();
    forms.verify.reset();
    toast("Inventory count verified.");
  });

  forms.target.addEventListener("submit", (event) => {
    event.preventDefault();
    const item = itemByKey(forms.target.elements.itemKey.value);
    const target = numberFrom(forms.target.elements.target.value);

    if (!item) {
      toast("Select an inventory lot first.");
      return;
    }

    item.target = Math.max(0, target);
    item.updatedAt = new Date().toISOString();
    saveAndRender();
    forms.target.reset();
    toast("Target amount updated.");
  });

  searchInput.addEventListener("input", render);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  parseOtcBtn.addEventListener("click", parseOtcCode);
  labelPhotoInput.addEventListener("change", previewLabelPhoto);
  extractLabelBtn.addEventListener("click", extractLabelInfo);

  render();

  function switchView(viewId) {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === viewId);
    });
    document.querySelectorAll(".job-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === viewId);
    });
  }

  function saveAndRender() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
    render();
  }

  function render() {
    inventory.sort(sortInventory);
    renderSummary();
    renderSelects();
    renderInventory();
    renderOrders();
  }

  function renderSummary() {
    const warningCount = inventory.filter((item) => statusFor(item) === "warning").length;
    const dangerCount = inventory.filter((item) => statusFor(item) === "danger").length;
    document.getElementById("totalLots").textContent = inventory.length;
    document.getElementById("warningLots").textContent = warningCount;
    document.getElementById("criticalLots").textContent = dangerCount;
  }

  function renderSelects() {
    const options = inventory.map((item) => {
      const label = `${item.manufacturer} | ${item.materialNumber} | Lot ${item.lotNumber} | Qty ${item.quantity}`;
      return `<option value="${escapeHtml(keyFor(item))}">${escapeHtml(label)}</option>`;
    });

    selects.forEach((select) => {
      select.innerHTML = options.length
        ? `<option value="">Select lot</option>${options.join("")}`
        : `<option value="">No inventory available</option>`;
    });
  }

  function renderInventory() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = inventory.filter((item) => searchableText(item).includes(query));
    inventoryList.innerHTML = "";

    if (!filtered.length) {
      inventoryList.innerHTML = `<p class="empty-state">${inventory.length ? "No matching inventory." : "Receive supplies to start tracking inventory."}</p>`;
      return;
    }

    filtered.forEach((item) => {
      const card = itemTemplate.content.firstElementChild.cloneNode(true);
      const status = statusFor(item);
      card.classList.add(`status-${status}`);
      card.querySelector("h3").textContent = item.manufacturer;
      card.querySelector(".material-line").textContent = `Material ${item.materialNumber}`;
      card.querySelector(".quantity-badge").textContent = item.quantity;
      card.querySelector(".lot").textContent = item.lotNumber;
      card.querySelector(".expiration").textContent = formatDate(item.expirationDate);
      card.querySelector(".target").textContent = item.target || 0;
      card.querySelector(".order").textContent = suggestedOrder(item);
      inventoryList.append(card);
    });
  }

  function renderOrders() {
    const needed = inventory
      .filter((item) => suggestedOrder(item) > 0)
      .sort((a, b) => suggestedOrder(b) - suggestedOrder(a));

    if (!needed.length) {
      orderList.innerHTML = `<p class="empty-state">All tracked lots are at or above target.</p>`;
      return;
    }

    orderList.innerHTML = needed
      .map((item) => {
        return `
          <article class="inventory-card status-warning">
            <div class="card-main">
              <div>
                <h3>${escapeHtml(item.manufacturer)}</h3>
                <p class="material-line">${escapeHtml(item.materialNumber)} | Lot ${escapeHtml(item.lotNumber)}</p>
              </div>
              <strong class="quantity-badge">${suggestedOrder(item)}</strong>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function exportCsv() {
    const header = [
      "Manufacturer",
      "Material Number",
      "Lot Number",
      "Expiration Date",
      "Quantity",
      "Target Amount",
      "Suggested Order",
      "Status",
      "Last Updated"
    ];

    const rows = inventory.map((item) => [
      item.manufacturer,
      item.materialNumber,
      item.lotNumber,
      item.expirationDate,
      item.quantity,
      item.target || 0,
      suggestedOrder(item),
      statusLabel(statusFor(item)),
      item.updatedAt
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lab-lens-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function parseOtcCode() {
    const value = clean(forms.receive.elements.otcCode.value);
    if (!value) {
      toast("Enter or scan an OTC code first.");
      return;
    }

    const parts = value.split(/[|,\t]/).map(clean);
    if (parts.length < 5) {
      toast("OTC code needs manufacturer, material, lot, expiration, and quantity.");
      return;
    }

    const [manufacturer, materialNumber, lotNumber, expirationDate, quantity, target] = parts;
    forms.receive.elements.manufacturer.value = manufacturer;
    forms.receive.elements.materialNumber.value = materialNumber;
    forms.receive.elements.lotNumber.value = lotNumber;
    forms.receive.elements.expirationDate.value = normalizeDate(expirationDate);
    forms.receive.elements.quantity.value = numberFrom(quantity) || "";
    forms.receive.elements.target.value = target ? numberFrom(target) : "";
    toast("Receiving form filled from OTC entry.");
  }

  function previewLabelPhoto() {
    const file = labelPhotoInput.files && labelPhotoInput.files[0];
    extractionStatus.hidden = true;
    extractionStatus.innerHTML = "";

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      previewUrl = "";
      photoPreview.hidden = true;
      labelPhotoPreview.removeAttribute("src");
      return;
    }

    previewUrl = URL.createObjectURL(file);
    labelPhotoPreview.src = previewUrl;
    photoPreview.hidden = false;
  }

  async function extractLabelInfo() {
    const file = labelPhotoInput.files && labelPhotoInput.files[0];
    if (!file) {
      toast("Please upload a photo first.");
      return;
    }

    extractLabelBtn.disabled = true;
    extractLabelBtn.textContent = "Analyzing label...";
    extractionStatus.hidden = false;
    extractionStatus.innerHTML = `<div class="status-row"><strong>Analyzing label...</strong><span>OpenAI vision</span></div>`;

    try {
      const imageDataUrl = await fileToDataUrl(file);
      const response = await fetch("/.netlify/functions/extract-label", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageDataUrl,
          fileName: file.name,
          mimeType: file.type
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Label extraction failed.");
      }

      const changedFields = applyExtractedFields(result);
      renderExtractionStatus(result);
      highlightChangedFields(changedFields);
      toast(result.reviewNeeded ? "Review needed before saving." : "Label info extracted. Review before saving.");
    } catch (error) {
      extractionStatus.innerHTML = `<div class="status-row"><strong>Extraction failed</strong><span class="needs-review">${escapeHtml(error.message)}</span></div>`;
      toast("Label extraction failed. Review needed.");
    } finally {
      extractLabelBtn.disabled = false;
      extractLabelBtn.textContent = "Extract Label Info";
    }
  }

  function applyExtractedFields(result) {
    const fieldMap = {
      manufacturer: "manufacturer",
      materialNumber: "materialNumber",
      lotNumber: "lotNumber",
      expirationDate: "expirationDate",
      quantityReceived: "quantity",
      targetAmount: "target"
    };

    const changedFields = [];

    Object.entries(fieldMap).forEach(([key, fieldName]) => {
      const field = forms.receive.elements[fieldName];
      const value = result[key] || "";
      field.value = value;
      if (value) changedFields.push(field);
    });

    return changedFields;
  }

  function highlightChangedFields(fields) {
    fields.forEach((field) => {
      field.classList.remove("auto-filled");
      void field.offsetWidth;
      field.classList.add("auto-filled");
      window.setTimeout(() => field.classList.remove("auto-filled"), 1800);
    });
  }

  function renderExtractionStatus(result) {
    const labels = [
      ["manufacturer", "Manufacturer"],
      ["materialNumber", "Material Number"],
      ["lotNumber", "Lot Number"],
      ["expirationDate", "Expiration Date"],
      ["quantityReceived", "Quantity Received"],
      ["targetAmount", "Target Amount"]
    ];

    extractionStatus.innerHTML = labels
      .map(([key, label]) => {
        const value = result[key];
        const status = value ? escapeHtml(value) : `<span class="needs-review">Review needed</span>`;
        return `<div class="status-row"><strong>${label}</strong><span>${status}</span></div>`;
      })
      .join("");
    extractionStatus.innerHTML += `
      <div class="status-row"><strong>Confidence</strong><span>${escapeHtml(result.confidence || "Review needed")}</span></div>
      <div class="status-row"><strong>Review Needed</strong><span>${result.reviewNeeded ? "Yes" : "No"}</span></div>
    `;
    extractionStatus.hidden = false;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(new Error("Could not read uploaded photo.")));
      reader.readAsDataURL(file);
    });
  }

  function clearPhotoCapture() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    labelPhotoInput.value = "";
    labelPhotoPreview.removeAttribute("src");
    photoPreview.hidden = true;
    extractionStatus.hidden = true;
    extractionStatus.innerHTML = "";
  }

  function loadInventory() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) && saved.length ? saved : seedInventory;
    } catch (error) {
      return seedInventory;
    }
  }

  function findItem(data) {
    const incomingKey = [
      data.manufacturer,
      data.materialNumber,
      data.lotNumber,
      data.expirationDate
    ].map(clean).join("::").toLowerCase();

    return inventory.find((item) => keyFor(item).toLowerCase() === incomingKey);
  }

  function itemByKey(key) {
    return inventory.find((item) => keyFor(item) === key);
  }

  function keyFor(item) {
    return [
      item.manufacturer,
      item.materialNumber,
      item.lotNumber,
      item.expirationDate
    ].map(clean).join("::");
  }

  function statusFor(item) {
    if (item.quantity <= 0 || daysUntil(item.expirationDate) < 0) return "danger";
    if (item.quantity < (item.target || 0) || daysUntil(item.expirationDate) <= 30) return "warning";
    return "ready";
  }

  function suggestedOrder(item) {
    return Math.max(0, (item.target || 0) - item.quantity);
  }

  function statusLabel(status) {
    if (status === "danger") return "Critical";
    if (status === "warning") return "Needs Action";
    return "Ready";
  }

  function daysUntil(dateValue) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiration = new Date(`${dateValue}T00:00:00`);
    return Math.ceil((expiration - today) / DAY_MS);
  }

  function formatDate(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function nextDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function normalizeDate(value) {
    const cleaned = clean(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

    const match = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return cleaned;

    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function numberFrom(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function searchableText(item) {
    return [
      item.manufacturer,
      item.materialNumber,
      item.lotNumber,
      item.expirationDate,
      item.quantity,
      item.target
    ].join(" ").toLowerCase();
  }

  function sortInventory(a, b) {
    return a.manufacturer.localeCompare(b.manufacturer)
      || a.materialNumber.localeCompare(b.materialNumber)
      || a.lotNumber.localeCompare(b.lotNumber)
      || a.expirationDate.localeCompare(b.expirationDate);
  }

  function csvValue(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char];
    });
  }

  function toast(message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();

    const notice = document.createElement("div");
    notice.className = "toast";
    notice.role = "status";
    notice.textContent = message;
    document.body.append(notice);
    window.setTimeout(() => notice.remove(), 2600);
  }
})();
