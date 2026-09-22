const TIMEZONE = 'America/Sao_Paulo';

export function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolvePotProfiles(item, profiles) {
  const description = normalizeText(item?.description);
  const availableProfiles = (Array.isArray(profiles) ? profiles : []).filter((profile) => asNumber(profile?.units_per_box) > 0);
  const byExactName = (name) => {
    const matches = availableProfiles.filter((profile) => normalizeText(profile.display_name) === normalizeText(name));
    return matches.length === 1 ? matches[0] : null;
  };

  if (description.includes('POTE DE VIDRO MARMITA')) {
    const volume = description.match(/\b(370|640)\s*ML\b/)?.[1];
    const kitSize = description.match(/\b(\d+)\s*POTES?\b/)?.[1];
    const profileName = volume === '370' && kitSize === '3'
      ? 'KIT 3X POTE 370ML (TAMPADO)'
      : volume === '640' && kitSize === '5'
        ? 'KIT 5X POTE 640ML (TAMPADO)'
        : volume === '640' && kitSize === '10'
          ? 'KIT 10X POTE 640ML (TAMPADO)'
          : '';
    const profile = profileName ? byExactName(profileName) : null;
    return profile ? [{ ...profile, units_per_sale: 1, mapping_source: 'perfil por descritivo' }] : [];
  }

  if (!description.includes('POTE DE VIDRO C/ TAMPA DE BAMBU')) return [];
  const shape = description.includes('QUADRADO') ? 'QUADRADO' : description.includes('REDONDO') ? 'REDONDO' : '';
  if (!shape) return [];
  const sizes = unique([...description.matchAll(/\b(\d{3,4})\s*ML\b/g)].map((match) => match[1]));
  if (!sizes.length) return [];
  const unitsInSingleSizeKit = description.includes('VARIADOS')
    ? 1
    : Math.max(1, asNumber(description.match(/\b(\d+)\s*UNIDADES?\b/)?.[1]));
  const targets = [];
  for (const size of sizes) {
    const matches = availableProfiles.filter((profile) => {
      const name = normalizeText(profile.display_name);
      return name.includes('POTE C/ TAMPA DE BAMBU')
        && name.includes(shape)
        && new RegExp(`\\b${size}\\s*ML\\b`).test(name);
    });
    if (matches.length !== 1) return [];
    targets.push({
      ...matches[0],
      units_per_sale: unitsInSingleSizeKit,
      mapping_source: description.includes('VARIADOS') ? 'kit misto desmembrado' : 'perfil por descritivo',
    });
  }
  return targets;
}

export function resolveTapeteHigienicoProfile(item) {
  const description = normalizeText(item?.description || item?.product);
  if (!description.includes('TAPETE HIG')) return null;
  return {
    display_name: item?.product || item?.description || 'Tapete higiênico',
    units_per_sale: 1,
    units_per_box: 6,
    physical_quantity: Math.max(0, asNumber(item?.package_quantity)),
    mapping_source: 'regra tapete higiênico (6 pacotes/caixa)',
  };
}

// O catálogo descreve caixas para kits fechados; para o pote simples usamos
// a menor capacidade física desses perfis, explicitamente como estimativa.
export function resolvePhysicalPotProfile(item, profiles) {
  const description = normalizeText(item?.description);
  if (!description.includes('POTE DE VIDRO MARMITA') || description.includes('KIT ')) return null;
  const volume = description.match(/\b(370|640)\s*ML\b/)?.[1];
  if (!volume) return null;
  const capacities = (Array.isArray(profiles) ? profiles : []).flatMap((profile) => {
    const match = normalizeText(profile?.display_name).match(/\bKIT\s+(\d+)X\s+POTE\s+(370|640)\s*ML\s*\(TAMPADO\)/);
    if (!match || match[2] !== volume || !(asNumber(profile?.units_per_box) > 0)) return [];
    return [asNumber(match[1]) * asNumber(profile.units_per_box)];
  });
  return capacities.length ? {
    display_name: item.product,
    units_per_sale: 1,
    units_per_box: Math.min(...capacities),
    mapping_source: 'capacidade conservadora dos perfis de kit',
  } : null;
}

export function buildOlistMultichannelReport(source, catalog, context) {
  const physicalUnits = source?.quantity_semantics === 'physical_components';
  const catalogRows = Array.isArray(catalog?.mappings) ? catalog.mappings : [];
  const mappings = new Map(catalogRows.map((entry) => [String(entry.olist_sku || '').trim(), entry]));
  const inputRows = Array.isArray(source?.rows) ? source.rows : [];
  const grouped = new Map();

  for (const raw of inputRows) {
    const sku = String(raw.sku || '').trim();
    const description = String(raw.description || raw.product || 'Produto sem descrição').trim();
    const product = String(raw.product || description).trim();
    const quantity = asNumber(raw.quantity);
    const key = sku ? `sku:${sku}` : `sem-sku:${product}\u0000${description}`;
    const current = grouped.get(key) || {
      sku,
      product,
      description,
      product_type: String(raw.product_type || '').trim(),
      primary_quantity: -1,
      orders_count: 0,
      sold_quantity: 0,
      package_quantity: 0,
      marketplaces: [],
      from_kit: false,
      kit_without_components: false,
    };
    if (quantity > current.primary_quantity) {
      current.product = product;
      current.description = description;
      current.product_type = String(raw.product_type || '').trim();
      current.primary_quantity = quantity;
    }
    current.orders_count += asNumber(raw.orders_count);
    current.sold_quantity += quantity;
    current.package_quantity += raw.package_quantity == null ? quantity : asNumber(raw.package_quantity);
    current.marketplaces = unique([...current.marketplaces, ...(Array.isArray(raw.marketplaces) ? raw.marketplaces : [])]);
    current.from_kit ||= Array.isArray(raw.expansion_sources) && raw.expansion_sources.some((entry) => String(entry).startsWith('kit:'));
    current.kit_without_components ||= raw.kit_without_components === true;
    grouped.set(key, current);
  }

  const rows = [];
  for (const item of grouped.values()) {
    const mapping = mappings.get(item.sku);
    const usableMapping = mapping && (!physicalUnits || item.kit_without_components || asNumber(mapping.units_per_sale) === 1);
    const tapeteProfile = physicalUnits && !item.kit_without_components
      ? resolveTapeteHigienicoProfile(item) : mapping ? null : resolveTapeteHigienicoProfile(item);
    const physicalPotProfile = physicalUnits && !item.kit_without_components && !usableMapping
      ? resolvePhysicalPotProfile(item, catalog?.profiles) : null;
    const fallbackTargets = tapeteProfile
      ? [tapeteProfile]
      : physicalPotProfile
        ? [physicalPotProfile]
        : resolvePotProfiles(item, catalog?.profiles);
    const targets = tapeteProfile || physicalPotProfile
      ? fallbackTargets
      : usableMapping
      ? [{ ...mapping, units_per_sale: physicalUnits && !item.kit_without_components ? 1 : mapping.units_per_sale, mapping_source: 'SKU Olist' }]
      : fallbackTargets.length
        ? fallbackTargets
        : [{ display_name: item.product, units_per_sale: 1, units_per_box: 0, mapping_source: 'sem cubagem' }];

    const itemRows = [];
    for (const target of targets) {
      const unitsPerSale = Math.max(1, asNumber(target.units_per_sale));
      const physicalQuantity = target.physical_quantity == null
        ? item.sold_quantity * unitsPerSale
        : Math.max(0, asNumber(target.physical_quantity));
      const unitsPerBox = asNumber(target.units_per_box);
      const boxes = unitsPerBox > 0 ? Math.floor(physicalQuantity / unitsPerBox) : 0;
      const looseUnits = unitsPerBox > 0 ? physicalQuantity % unitsPerBox : physicalQuantity;
      const components = mapping && Array.isArray(target.components) && target.components.length
        ? target.components
        : [target.display_name || item.product];
      for (const component of components) {
        itemRows.push({
          component: String(component || item.product),
          physical_quantity: physicalQuantity,
          units_per_sale: unitsPerSale,
          units_per_box: unitsPerBox,
          boxes,
          loose_units: looseUnits,
          mapping_source: target.mapping_source,
          unmapped: unitsPerBox <= 0,
        });
      }
    }
    rows.push({
      sku: item.sku,
      product: item.product,
      description: item.description,
      product_type: item.product_type,
      orders_count: item.orders_count,
      sold_quantity: item.sold_quantity,
      physical_quantity: itemRows.reduce((sum, row) => sum + row.physical_quantity, 0),
      boxes: itemRows.reduce((sum, row) => sum + row.boxes, 0),
      loose_units: itemRows.reduce((sum, row) => sum + row.loose_units, 0),
      marketplaces: item.marketplaces,
      mapping_source: unique(itemRows.map((row) => row.mapping_source)).join(' | '),
      unmapped: itemRows.some((row) => row.unmapped),
      force_print: item.from_kit || item.kit_without_components,
    });
  }

  rows.sort((left, right) =>
    right.boxes - left.boxes
    || right.loose_units - left.loose_units
    || right.physical_quantity - left.physical_quantity
    || left.product.localeCompare(right.product, 'pt-BR')
    || left.description.localeCompare(right.description, 'pt-BR')
  );

  return {
    source: 'Olist ERP via Oráculo/Supabase',
    timezone: TIMEZONE,
    cursor_start: context.cursor_start,
    cursor_end: context.cursor_end,
    operational_period_start: context.period_start,
    operational_period_end: context.period_end,
    orders_count: asNumber(source?.orders_count),
    orders_without_items: asNumber(source?.orders_without_items),
    marketplaces: Array.isArray(source?.marketplaces) ? source.marketplaces : [],
    marketplace_count: Array.isArray(source?.marketplaces) ? source.marketplaces.length : 0,
    units_sold: [...grouped.values()].reduce((sum, row) => sum + row.sold_quantity, 0),
    boxes_total: rows.reduce((sum, row) => sum + row.boxes, 0),
    loose_units_total: rows.reduce((sum, row) => sum + row.loose_units, 0),
    unmapped_count: rows.filter((row) => row.unmapped).length,
    rows,
  };
}

export function csvEscape(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return `"${text.replace(/"/g, '""')}"`;
}

export function displaySeparationProduct(row) {
  const product = String(row?.product || row?.description || 'Produto sem descrição').trim();
  const warning = 'KIT SEM COMPOSIÇÃO NO OLIST';
  return String(row?.description || '').includes(warning) && !product.includes(warning)
    ? `${product} · ${warning}` : product;
}

export function buildOlistMultichannelCsv(report) {
  const headers = ['SKU', 'Produto', 'Unidades a separar', 'Caixas', 'Unidades avulsas'];
  const lines = [headers.map(csvEscape).join(';')];
  const rows = (report?.rows || [])
    .filter((row) => asNumber(row.boxes) >= 1 || row.force_print === true)
    .sort((left, right) => asNumber(right.boxes) - asNumber(left.boxes) || asNumber(right.loose_units) - asNumber(left.loose_units));
  for (const row of rows) {
    lines.push([
      row.sku,
      displaySeparationProduct(row),
      row.sold_quantity,
      row.boxes,
      row.loose_units,
    ].map(csvEscape).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildOlistMultichannelMessages(report, context, maxChars = 3400) {
  const rows = (Array.isArray(report?.rows) ? report.rows : [])
    .filter((row) => asNumber(row.boxes) >= 1 || row.force_print === true)
    .sort((left, right) => asNumber(right.boxes) - asNumber(left.boxes) || asNumber(right.loose_units) - asNumber(left.loose_units));
  const mode = ['send', 'test_send', 'oraculo', 'resend'].includes(context?.mode) ? context.mode : 'preview';
  const formatDateTime = (value) => new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
  const truncate = (value, max) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  };
  const header = [
    mode === 'test_send' ? '*TESTE — SEPARAÇÃO TODOS OS MARKETPLACES*' : '*SEPARAÇÃO — TODOS OS MARKETPLACES*',
    `Fechamento operacional: ${formatDateTime(report.operational_period_start)} até ${formatDateTime(report.operational_period_end)}`,
    '_O mesmo SKU foi somado e aparece em uma única linha._',
  ].filter(Boolean).join('\n');
  const footer = mode === 'test_send'
    ? '_Mensagem de teste — cursor oficial não alterado._\n_Fonte: Olist ERP via Oráculo/Supabase_'
    : '_Fonte: Olist ERP via Oráculo/Supabase_';
  const lines = rows.length ? rows.map((row, index) => {
    return `${index + 1}. SKU: *${row.sku || '-'}* | Produto: ${displaySeparationProduct(row)} | Unidades a separar: *${row.sold_quantity.toLocaleString('pt-BR')}* | Caixas: *${row.boxes.toLocaleString('pt-BR')}* | Unidades avulsas: *${row.loose_units.toLocaleString('pt-BR')}*`;
  }) : ['Nenhum SKU formou ao menos 1 caixa neste fechamento.'];

  const groups = [];
  let current = [];
  for (const line of lines) {
    const candidate = [...current, line].join('\n');
    if (current.length && header.length + candidate.length + footer.length + 100 > maxChars) {
      groups.push(current);
      current = [line];
    } else current.push(line);
  }
  if (current.length) groups.push(current);

  return groups.map((group, index) => {
    const part = groups.length > 1 ? `\nParte ${index + 1}/${groups.length}` : '';
    const messageText = `${header}${part}\n\n${group.join('\n')}\n\n${footer}`;
    if (messageText.length > maxChars) throw new Error(`Mensagem ${index + 1} excedeu ${maxChars} caracteres.`);
    return {
      mode,
      slot_key: String(context.slot_key),
      cursor_start: String(context.cursor_start),
      cursor_end: String(context.cursor_end),
      part_number: index + 1,
      parts_total: groups.length,
      message_text: messageText,
    };
  });
}
