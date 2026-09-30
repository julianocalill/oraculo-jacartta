const $ = (id) => document.getElementById(id);
const metricIds = ["impressions", "clicks", "ctr", "items_sold", "sales", "spend", "roas"];
const inputIds = ["target_roas", "daily_budget", "contribution_margin_pct", "period_start", "period_end", "last_optimization", "budget_mode", "budget_consumed", "store", "item"];
let file = null;
let report = null;
let previewUrl = null;

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function selectFile(selected) {
  if (!selected) return;
  if (!["image/png", "image/jpeg"].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
    setStatus("Envie um PNG ou JPEG de até 10 MB.", true);
    return;
  }
  file = selected;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $("preview").src = previewUrl;
  $("preview").hidden = false;
  $("preview-empty").hidden = true;
  $("file-name").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  $("read").disabled = false;
  $("review").hidden = true;
  $("context").hidden = true;
  $("report").hidden = true;
  setStatus("Print pronto para leitura.");
}

$("image").addEventListener("change", (event) => selectFile(event.target.files[0]));
for (const type of ["dragenter", "dragover"]) $("drop-zone").addEventListener(type, (event) => {
  event.preventDefault();
  $("drop-zone").classList.add("dragging");
});
for (const type of ["dragleave", "drop"]) $("drop-zone").addEventListener(type, (event) => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragging");
});
$("drop-zone").addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

function dateFromDayMonth(value, currentYear) {
  const [day, month] = value.split("/").map(Number);
  const candidate = new Date(currentYear, month - 1, day);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  return candidate;
}

function inferPeriod(period) {
  if (!period) return;
  const now = new Date();
  let end = dateFromDayMonth(period.end, now.getFullYear());
  if (!end) return;
  if (end > new Date(now.getTime() + 86400000)) end = dateFromDayMonth(period.end, now.getFullYear() - 1);
  let start = dateFromDayMonth(period.start, end.getFullYear());
  if (!start || start > end) start = dateFromDayMonth(period.start, end.getFullYear() - 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (start) $("period_start").value = iso(start);
  $("period_end").value = iso(end);
}

async function post(path, data) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Falha na análise.");
  return result;
}

function dataUrl(selected) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível abrir o arquivo."));
    reader.readAsDataURL(selected);
  });
}

$("read").addEventListener("click", async () => {
  if (!file) return;
  $("read").disabled = true;
  setStatus("Lendo o print com o OCR do macOS. A primeira análise pode levar alguns segundos...");
  try {
    const data = await dataUrl(file);
    const result = await post("/api/read", { image: data.split(",")[1], mime: file.type });
    for (const id of metricIds) {
      const value = result.metrics[id];
      $(id).value = value === null || value === undefined ? "" : String(value).replace(".", ",");
    }
    inferPeriod(result.period);
    $("read-count").textContent = `${result.recognized_lines} trechos lidos`;
    $("ocr-lines").textContent = (result.ocr_lines || []).join("\n");
    $("review").hidden = false;
    $("context").hidden = false;
    setStatus("Leitura concluída. Confira os valores e complete o contexto para classificar o cenário.");
    await analyzePrint();
    $("review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $("read").disabled = false;
  }
});

function payload() {
  const metrics = Object.fromEntries(metricIds.map((id) => [id, $(id).value]));
  const values = Object.fromEntries(inputIds.map((id) => [id, $(id).value]));
  return { metrics, ...values, recent_price_change: $("recent_price_change").checked, low_stock: $("low_stock").checked };
}

function renderList(id, items) {
  const list = $(id);
  list.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
}

function render(result) {
  report = result;
  $("report").hidden = false;
  $("scenario").textContent = result.scenario_name;
  $("scenario").classList.toggle("pending", !result.scenario);
  renderList("findings", result.findings);
  renderList("actions", result.actions);
  renderList("warnings", result.warnings);
  renderList("missing", result.missing);
  $("warnings-wrap").hidden = result.warnings.length === 0;
  $("missing-wrap").hidden = result.missing.length === 0;
  $("basis").textContent = result.basis;
}

async function analyzePrint() {
  $("analyze").disabled = true;
  try {
    render(await post("/api/analyze", payload()));
    setStatus("Recomendações atualizadas. Nenhuma alteração foi feita na campanha.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $("analyze").disabled = false;
  }
}
$("analyze").addEventListener("click", analyzePrint);
$("budget_mode").addEventListener("change", () => {
  $("budget-field").hidden = $("budget_mode").value !== "limited";
  $("budget_consumed").disabled = $("budget_mode").value !== "limited";
});
$("budget_mode").dispatchEvent(new Event("change"));

$("copy").addEventListener("click", async () => {
  if (!report) return;
  const lines = [
    `Análise Shopee Ads${$("item").value ? ` · ${$("item").value}` : ""}${$("store").value ? ` · ${$("store").value}` : ""}`,
    report.scenario_name,
    "", "Leitura:", ...report.findings.map((x) => `- ${x}`),
    "", "Sugestões:", ...report.actions.map((x) => `- ${x}`),
    ...(report.warnings.length ? ["", "Atenção:", ...report.warnings.map((x) => `- ${x}`)] : []),
    ...(report.missing.length ? ["", "Falta confirmar:", ...report.missing.map((x) => `- ${x}`)] : []),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    $("copy").textContent = "Copiado ✓";
    setTimeout(() => { $("copy").textContent = "Copiar análise"; }, 1800);
  } catch {
    setStatus("Não foi possível copiar automaticamente neste navegador.", true);
  }
});
