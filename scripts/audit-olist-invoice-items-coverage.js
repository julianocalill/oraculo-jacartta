#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const env = { ...process.env };
  try {
    const file = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = env[key] || value;
    }
  } catch {}
  return env;
}

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function requireEnv(env, keys) {
  for (const key of keys) if (env[key]) return env[key];
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const parsed = Number(String(value).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(parseNumber(value));
}

function count(value) {
  return new Intl.NumberFormat("pt-BR").format(parseNumber(value));
}

function pct(value) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(parseNumber(value))}%`;
}

async function supabaseFetch(env, path, options = {}) {
  const key = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const url = `${requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/$/, "")}${path}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(options.headers ?? {})
        }
      });
      text = await response.text();
    } catch (error) {
      if (attempt === 4) throw new Error(`Supabase fetch failed for ${path.slice(0, 160)}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }

    if (response.ok) return text ? JSON.parse(text) : null;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`Supabase request failed (${response.status}) for ${path.slice(0, 160)}: ${text.slice(0, 500)}`);
  }

  return null;
}

async function writeFiscalSnapshot(env, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  await supabaseFetch(env, "/rest/v1/oraculo_fiscal_snapshots", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify(rows)
  });
}

async function fetchAll(env, path, pageSize = 1000) {
  const rows = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseFetch(env, `${path}${separator}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page)) return rows;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addOrderKey(map, key, order, method) {
  if (key == null || String(key).trim() === "") return;
  const normalized = String(key).trim();
  if (!map.has(normalized)) map.set(normalized, { order, method });
}

async function buildCoverageReport(env, start, end, sampleLimit) {
  const endExclusive = addDays(end, 1);
  const encodedStart = encodeURIComponent(`${start}T00:00:00.000Z`);
  const encodedEnd = encodeURIComponent(`${endExclusive}T00:00:00.000Z`);
  const fiscalOrderProgress = await supabaseFetch(
    env,
    "/rest/v1/rpc/oraculo_fiscal_order_item_backfill_progress",
    {
      method: "POST",
      body: JSON.stringify({ p_start_date: start, p_end_date: end })
    }
  );

  const [invoices, invoiceItems, orders, orderItems] = await Promise.all([
    fetchAll(
      env,
      `/rest/v1/oraculo_fiscal_invoices_valid?select=id,invoice_number,issued_at,client_name,uf,billed_revenue,order_id,order_number,channel_label&issued_at=gte.${encodedStart}&issued_at=lt.${encodedEnd}&order=issued_at.asc,id.asc`
    ),
    fetchAll(env, "/rest/v1/olist_invoice_items?select=invoice_id,sku,total_value"),
    fetchAll(
      env,
      `/rest/v1/olist_orders?select=id,numero_pedido,ecom:payload->ecommerce->>numeroPedidoEcommerce,canal:payload->ecommerce->>numeroPedidoCanalVenda,ordem:payload->>numeroOrdemCompra&data_criacao=gte.${encodedStart}&data_criacao=lt.${encodedEnd}&order=data_criacao.asc`
    ),
    fetchAll(
      env,
      `/rest/v1/olist_order_items?select=order_id,sku,quantidade,valor_total&order_data_criacao=gte.${encodedStart}&order_data_criacao=lt.${encodedEnd}&order=order_data_criacao.asc`
    )
  ]);
  const invoiceItemsByInvoice = new Map();
  const invoiceSkuSet = new Set();
  for (const item of invoiceItems) {
    const invoiceId = String(item.invoice_id ?? "");
    if (!invoiceId) continue;
    const entry = invoiceItemsByInvoice.get(invoiceId) ?? { itemRows: 0, skuSet: new Set(), revenue: 0 };
    entry.itemRows += 1;
    if (item.sku) {
      entry.skuSet.add(String(item.sku));
      invoiceSkuSet.add(String(item.sku));
    }
    entry.revenue += parseNumber(item.total_value);
    invoiceItemsByInvoice.set(invoiceId, entry);
  }

  const ordersById = new Map();
  const ordersByExternal = new Map();
  for (const order of orders) {
    ordersById.set(String(order.id), { order, method: "order_id" });
    addOrderKey(ordersByExternal, order.ecom, order, "ecommerce.numeroPedidoEcommerce");
    addOrderKey(ordersByExternal, order.canal, order, "ecommerce.numeroPedidoCanalVenda");
    addOrderKey(ordersByExternal, order.ordem, order, "numeroOrdemCompra");
    addOrderKey(ordersByExternal, order.numero_pedido, order, "numero_pedido");
  }

  const orderItemsByOrder = new Map();
  const orderSkuSet = new Set();
  for (const item of orderItems) {
    const orderId = String(item.order_id ?? "");
    if (!orderId) continue;
    const entry = orderItemsByOrder.get(orderId) ?? { itemRows: 0, skuSet: new Set(), units: 0, revenue: 0 };
    entry.itemRows += 1;
    if (item.sku) {
      entry.skuSet.add(String(item.sku));
      orderSkuSet.add(String(item.sku));
    }
    entry.units += parseNumber(item.quantidade);
    entry.revenue += parseNumber(item.valor_total);
    orderItemsByOrder.set(orderId, entry);
  }

  const linkMethods = new Map();
  const examplesWithoutInvoiceItems = [];
  const examplesWithOrderItems = [];
  const metrics = {
    total_valid_invoices: invoices.length,
    total_valid_revenue: 0,
    invoices_with_invoice_items: 0,
    revenue_with_invoice_items: 0,
    invoices_without_invoice_items: 0,
    revenue_without_invoice_items: 0,
    invoices_with_order_reference: 0,
    invoices_with_matched_order: 0,
    invoices_with_order_items: 0,
    revenue_with_order_items: 0,
    invoices_without_order_items: 0,
    revenue_without_order_items: 0,
    order_item_rows: 0,
    order_item_units: 0,
    order_item_revenue: 0
  };

  for (const invoice of invoices) {
    const invoiceId = String(invoice.id);
    const revenue = parseNumber(invoice.billed_revenue);
    metrics.total_valid_revenue += revenue;

    const invoiceItemEntry = invoiceItemsByInvoice.get(invoiceId);
    const hasInvoiceItems = Boolean(invoiceItemEntry?.itemRows);
    if (hasInvoiceItems) {
      metrics.invoices_with_invoice_items += 1;
      metrics.revenue_with_invoice_items += revenue;
    } else {
      metrics.invoices_without_invoice_items += 1;
      metrics.revenue_without_invoice_items += revenue;
      if (examplesWithoutInvoiceItems.length < sampleLimit) {
        examplesWithoutInvoiceItems.push(invoice);
      }
    }

    if (invoice.order_id || invoice.order_number) metrics.invoices_with_order_reference += 1;

    const direct = invoice.order_id ? ordersById.get(String(invoice.order_id)) : null;
    const external = invoice.order_number ? ordersByExternal.get(String(invoice.order_number)) : null;
    const linked = direct ?? external ?? null;
    const orderId = linked?.order?.id == null ? null : String(linked.order.id);

    if (orderId) {
      metrics.invoices_with_matched_order += 1;
      linkMethods.set(linked.method, (linkMethods.get(linked.method) ?? 0) + 1);
    }

    const orderItemEntry = orderId ? orderItemsByOrder.get(orderId) : null;
    if (orderItemEntry?.itemRows) {
      metrics.invoices_with_order_items += 1;
      metrics.revenue_with_order_items += revenue;
      metrics.order_item_rows += orderItemEntry.itemRows;
      metrics.order_item_units += orderItemEntry.units;
      metrics.order_item_revenue += orderItemEntry.revenue;
      if (examplesWithOrderItems.length < sampleLimit) {
        examplesWithOrderItems.push({
          ...invoice,
          linked_order_id: orderId,
          link_method: linked.method,
          item_rows: orderItemEntry.itemRows,
          sku_count: orderItemEntry.skuSet.size,
          units: orderItemEntry.units,
          item_revenue: orderItemEntry.revenue
        });
      }
    } else {
      metrics.invoices_without_order_items += 1;
      metrics.revenue_without_order_items += revenue;
    }
  }

  const officialOrderMetrics = fiscalOrderProgress?.metrics ?? null;
  const officialOrderCoverage = fiscalOrderProgress?.coverage ?? null;
  if (officialOrderMetrics && officialOrderCoverage) {
    metrics.invoices_with_matched_order = parseNumber(officialOrderMetrics.invoices_with_matched_order);
    metrics.invoices_with_order_items = parseNumber(officialOrderMetrics.invoices_with_order_items);
    metrics.revenue_with_order_items = parseNumber(officialOrderMetrics.revenue_with_order_items);
    metrics.invoices_without_order_items = parseNumber(officialOrderMetrics.invoices_without_order_items);
    metrics.revenue_without_order_items = parseNumber(officialOrderMetrics.revenue_without_order_items);
    orderSkuSet.clear();
  }

  return {
    period: { start, end },
    metrics,
    link_methods: Array.from(linkMethods.entries())
      .map(([link_method, invoices]) => ({ link_method, invoices }))
      .sort((left, right) => right.invoices - left.invoices),
    sku_counts: {
      distinct_invoice_item_skus: invoiceSkuSet.size,
      distinct_order_item_skus: fiscalOrderProgress
        ? parseNumber(fiscalOrderProgress.distinct_order_item_skus)
        : orderSkuSet.size
    },
    coverage: {
      invoice_item_invoice_pct: metrics.total_valid_invoices ? metrics.invoices_with_invoice_items / metrics.total_valid_invoices * 100 : 0,
      invoice_item_revenue_pct: metrics.total_valid_revenue ? metrics.revenue_with_invoice_items / metrics.total_valid_revenue * 100 : 0,
      order_link_invoice_pct: officialOrderCoverage
        ? parseNumber(officialOrderCoverage.order_link_invoice_pct)
        : metrics.total_valid_invoices ? metrics.invoices_with_matched_order / metrics.total_valid_invoices * 100 : 0,
      order_items_invoice_pct: officialOrderCoverage
        ? parseNumber(officialOrderCoverage.order_items_invoice_pct)
        : metrics.total_valid_invoices ? metrics.invoices_with_order_items / metrics.total_valid_invoices * 100 : 0,
      order_items_revenue_pct: officialOrderCoverage
        ? parseNumber(officialOrderCoverage.order_items_revenue_pct)
        : metrics.total_valid_revenue ? metrics.revenue_with_order_items / metrics.total_valid_revenue * 100 : 0,
      missing_order_items_revenue_pct: officialOrderCoverage
        ? parseNumber(officialOrderCoverage.missing_order_items_revenue_pct)
        : metrics.total_valid_revenue ? metrics.revenue_without_order_items / metrics.total_valid_revenue * 100 : 0
    },
    examples: {
      valid_invoices_without_invoice_items: examplesWithoutInvoiceItems,
      valid_invoices_with_order_items: examplesWithOrderItems
    }
  };
}

function recommendation(report) {
  const coverage = report.coverage ?? {};
  const orderInvoicePct = parseNumber(coverage.order_items_invoice_pct);
  const missingRevenuePct = parseNumber(coverage.missing_order_items_revenue_pct);
  const invoiceItemPct = parseNumber(coverage.invoice_item_invoice_pct);

  if (invoiceItemPct >= 98 || missingRevenuePct <= 0.5) {
    return "item_fiscal_puro_pode_ser_oficializado_apos_conferencia";
  }

  if (orderInvoicePct >= 98 || missingRevenuePct <= 0.5) {
    return "propor_oraculo_fiscal_sku_sales_by_order_link_como_ponte";
  }

  return "bloqueado_para_sku_roi_margem_roas";
}

function toMarkdown(report) {
  const metrics = report.metrics ?? {};
  const coverage = report.coverage ?? {};
  const skuCounts = report.sku_counts ?? {};
  const examples = report.examples ?? {};
  const rec = recommendation(report);

  const lines = [
    "# Cobertura de Itens Fiscais",
    "",
    `Periodo: \`${report.period?.start}\` a \`${report.period?.end}\``,
    "",
    "## Resultado",
    "",
    `- Total de NFs validas: \`${count(metrics.total_valid_invoices)}\``,
    `- Receita fiscal validada: \`${money(metrics.total_valid_revenue)}\``,
    `- NFs com itens em \`olist_invoice_items\`: \`${count(metrics.invoices_with_invoice_items)}\` (${pct(coverage.invoice_item_invoice_pct)})`,
    `- Receita coberta por \`olist_invoice_items\`: \`${money(metrics.revenue_with_invoice_items)}\` (${pct(coverage.invoice_item_revenue_pct)})`,
    `- NFs com referencia de pedido: \`${count(metrics.invoices_with_order_reference)}\``,
    `- NFs com pedido encontrado: \`${count(metrics.invoices_with_matched_order)}\` (${pct(coverage.order_link_invoice_pct)})`,
    `- NFs com pedido encontrado e itens em \`olist_order_items\`: \`${count(metrics.invoices_with_order_items)}\` (${pct(coverage.order_items_invoice_pct)})`,
    `- Receita coberta via pedido+itens: \`${money(metrics.revenue_with_order_items)}\` (${pct(coverage.order_items_revenue_pct)})`,
    `- Receita sem itens via pedido: \`${money(metrics.revenue_without_order_items)}\` (${pct(coverage.missing_order_items_revenue_pct)})`,
    `- SKUs distintos em itens fiscais puros: \`${count(skuCounts.distinct_invoice_item_skus)}\``,
    `- SKUs distintos via pedido vinculado: \`${count(skuCounts.distinct_order_item_skus)}\``,
    "",
    "## Leitura",
    "",
    "- `notas/{id}` existe e pode retornar itens, mas a cobertura atual em `olist_invoice_items` ainda e baixa para virar SKU fiscal oficial.",
    "- O caminho alternativo e usar a NF valida como fonte financeira e o pedido vinculado como ponte para distribuir a receita por SKU via `olist_order_items`.",
    "- Se essa ponte atingir pelo menos 98% das NFs validas ou deixar menos de 0,5% da receita sem cobertura, a view candidata deve se chamar `oraculo_fiscal_sku_sales_by_order_link`, para deixar claro que nao e item fiscal puro.",
    `- Recomendacao atual: \`${rec}\``,
    "",
    "## Exemplos de NFs validas sem item fiscal puro",
    ""
  ];

  for (const row of examples.valid_invoices_without_invoice_items ?? []) {
    lines.push(`- NF ${row.invoice_number ?? row.id}: ${row.issued_at} · ${money(row.billed_revenue)} · pedido ${row.order_id ?? row.order_number ?? "-"}`);
  }

  lines.push("", "## Exemplos de NFs validas com pedido e itens", "");

  for (const row of examples.valid_invoices_with_order_items ?? []) {
    lines.push(`- NF ${row.invoice_number ?? row.id}: pedido ${row.linked_order_id} · ${count(row.item_rows)} linhas · ${count(row.sku_count)} SKUs · itens ${money(row.item_revenue)} · NF ${money(row.billed_revenue)}`);
  }

  lines.push("", "## Trava de produto", "");
  lines.push("Nao liberar margem, ROI, ROAS, lucro ou SKU fiscal oficial ate a cobertura passar no criterio de aceite.");

  if (Array.isArray(report.link_methods) && report.link_methods.length > 0) {
    lines.push("", "## Métodos de vínculo encontrados", "");
    for (const method of report.link_methods) {
      lines.push(`- ${method.link_method}: ${count(method.invoices)} NFs`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const env = loadEnv();
  const start = arg("start", "2026-06-01");
  const end = arg("end", "2026-06-19");
  const sampleLimit = Number(arg("sample-limit", "10"));

  const report = await buildCoverageReport(env, start, end, sampleLimit);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--write-snapshot")) {
      await writeFiscalSnapshot(env, [
        {
          snapshot_key: "sku_coverage",
          snapshot_label: "SKU coverage snapshot",
          period_start: start,
          period_end: end,
          payload: {
            total_valid_invoices: report.metrics?.total_valid_invoices ?? 0,
            total_valid_revenue: report.metrics?.total_valid_revenue ?? 0,
            invoices_with_matched_order: report.metrics?.invoices_with_matched_order ?? 0,
            invoices_with_order_items: report.metrics?.invoices_with_order_items ?? 0,
            revenue_with_order_items: report.metrics?.revenue_with_order_items ?? 0,
            invoices_without_order_items: report.metrics?.invoices_without_order_items ?? 0,
            revenue_without_order_items: report.metrics?.revenue_without_order_items ?? 0,
            order_link_invoice_pct: report.coverage?.order_link_invoice_pct ?? 0,
            order_items_invoice_pct: report.coverage?.order_items_invoice_pct ?? 0,
            order_items_revenue_pct: report.coverage?.order_items_revenue_pct ?? 0,
            missing_order_items_revenue_pct: report.coverage?.missing_order_items_revenue_pct ?? 0,
            distinct_order_item_skus: report.sku_counts?.distinct_order_item_skus ?? 0
          }
        }
      ]);
    }
    return;
  }

  const metrics = report.metrics ?? {};
  const coverage = report.coverage ?? {};
  const skuCounts = report.sku_counts ?? {};
  const rec = recommendation(report);

  console.log(`Periodo fiscal: ${start} a ${end}`);
  console.log("");
  console.log("Cobertura fiscal pura");
  console.log(`- NFs validas: ${count(metrics.total_valid_invoices)} / ${money(metrics.total_valid_revenue)}`);
  console.log(`- NFs com itens em olist_invoice_items: ${count(metrics.invoices_with_invoice_items)} (${pct(coverage.invoice_item_invoice_pct)})`);
  console.log(`- Receita com itens fiscais puros: ${money(metrics.revenue_with_invoice_items)} (${pct(coverage.invoice_item_revenue_pct)})`);
  console.log(`- SKUs fiscais puros distintos: ${count(skuCounts.distinct_invoice_item_skus)}`);
  console.log("");
  console.log("Cobertura via pedido vinculado");
  console.log(`- NFs com referencia de pedido: ${count(metrics.invoices_with_order_reference)}`);
  console.log(`- NFs com pedido encontrado: ${count(metrics.invoices_with_matched_order)} (${pct(coverage.order_link_invoice_pct)})`);
  console.log(`- NFs com pedido + itens: ${count(metrics.invoices_with_order_items)} (${pct(coverage.order_items_invoice_pct)})`);
  console.log(`- Receita coberta via pedido + itens: ${money(metrics.revenue_with_order_items)} (${pct(coverage.order_items_revenue_pct)})`);
  console.log(`- Receita sem cobertura via pedido + itens: ${money(metrics.revenue_without_order_items)} (${pct(coverage.missing_order_items_revenue_pct)})`);
  console.log(`- SKUs via pedido distintos: ${count(skuCounts.distinct_order_item_skus)}`);
  if (Array.isArray(report.link_methods) && report.link_methods.length > 0) {
    console.log("- Vínculos:");
    for (const method of report.link_methods) {
      console.log(`  · ${method.link_method}: ${count(method.invoices)} NFs`);
    }
  }
  console.log("");
  console.log(`Recomendacao: ${rec}`);

  if (process.argv.includes("--write-snapshot")) {
    await writeFiscalSnapshot(env, [
      {
        snapshot_key: "sku_coverage",
        snapshot_label: "SKU coverage snapshot",
        period_start: start,
        period_end: end,
        payload: {
          total_valid_invoices: metrics.total_valid_invoices ?? 0,
          total_valid_revenue: metrics.total_valid_revenue ?? 0,
          invoices_with_matched_order: metrics.invoices_with_matched_order ?? 0,
          invoices_with_order_items: metrics.invoices_with_order_items ?? 0,
          revenue_with_order_items: metrics.revenue_with_order_items ?? 0,
          invoices_without_order_items: metrics.invoices_without_order_items ?? 0,
          revenue_without_order_items: metrics.revenue_without_order_items ?? 0,
          order_link_invoice_pct: coverage.order_link_invoice_pct ?? 0,
          order_items_invoice_pct: coverage.order_items_invoice_pct ?? 0,
          order_items_revenue_pct: coverage.order_items_revenue_pct ?? 0,
          missing_order_items_revenue_pct: coverage.missing_order_items_revenue_pct ?? 0,
          distinct_order_item_skus: skuCounts.distinct_order_item_skus ?? 0
        }
      }
    ]);
  }

  const outputPath = arg("write-doc", "");
  if (outputPath) {
    writeFileSync(outputPath, toMarkdown(report));
    console.log(`Documento escrito em ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
