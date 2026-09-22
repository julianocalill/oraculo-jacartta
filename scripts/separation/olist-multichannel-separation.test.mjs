import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOlistMultichannelReport, buildOlistMultichannelCsv,
  buildOlistMultichannelMessages } from './olist-multichannel-separation.mjs';

const context = {
  mode: 'preview', slot_key: '2026-09-22-0700',
  cursor_start: '2026-09-21T17:30:00Z', cursor_end: '2026-09-22T10:00:00Z',
  period_start: '2026-09-21T14:30:00-03:00', period_end: '2026-09-22T07:00:00-03:00',
};

test('componente de tapete e venda direta viram uma linha física sem multiplicar duas vezes', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', orders_count: 40, marketplaces: [],
    rows: [{ sku: '213169', product: 'TAPETE HIG 50X60 50UN', description: 'TAPETE HIG 50X60 50UN',
      quantity: 82, package_quantity: 82, orders_count: 40,
      expansion_sources: ['direto', 'kit:213849'] }],
  }, { mappings: [{ olist_sku: '213169', units_per_sale: 2, units_per_box: 4 }] }, context);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].sold_quantity, 82);
  assert.equal(report.rows[0].boxes, 13);
  assert.equal(report.rows[0].loose_units, 4);
  assert.equal(report.rows[0].force_print, true);
});

test('componente sem cubagem segue visível como unidades avulsas', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: 'COMP', product: 'Componente',
      description: 'Componente', quantity: 3, expansion_sources: ['kit:K'] }],
  }, { mappings: [] }, context);
  assert.equal(report.rows[0].boxes, 0);
  assert.equal(report.rows[0].loose_units, 3);
  assert.match(buildOlistMultichannelCsv(report), /COMP/);
  assert.match(buildOlistMultichannelMessages(report, context)[0].message_text, /COMP/);
});

test('vendas sem caixa fechada entram no CSV e WhatsApp após os SKUs com mais caixas', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [
      { sku: 'AVULSO', product: 'Produto avulso', description: 'Produto avulso', quantity: 2 },
      { sku: 'CAIXA', product: 'Produto com caixa', description: 'Produto com caixa', quantity: 20 },
    ],
  }, { mappings: [
    { olist_sku: 'AVULSO', units_per_sale: 1, units_per_box: 6 },
    { olist_sku: 'CAIXA', units_per_sale: 1, units_per_box: 10 },
  ] }, context);
  assert.deepEqual(report.rows.map((row) => [row.sku, row.boxes]), [['CAIXA', 2], ['AVULSO', 0]]);
  const csv = buildOlistMultichannelCsv(report);
  const message = buildOlistMultichannelMessages(report, context)[0].message_text;
  assert.ok(csv.indexOf('CAIXA') < csv.indexOf('AVULSO'));
  assert.ok(message.indexOf('CAIXA') < message.indexOf('AVULSO'));
});

test('pote simples usa capacidade física conservadora dos perfis existentes', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: '213877',
      product: 'POTE DE VIDRO MARMITA - BRANCO - 640ML',
      description: 'POTE DE VIDRO MARMITA - BRANCO - 640ML', quantity: 330,
      expansion_sources: ['kit:213969'] }],
  }, { profiles: [
    { display_name: 'KIT 5X POTE 640ML (TAMPADO)', units_per_box: 6 },
    { display_name: 'KIT 10X POTE 640ML (TAMPADO)', units_per_box: 4 },
  ], mappings: [] }, context);
  assert.equal(report.rows[0].sold_quantity, 330);
  assert.equal(report.rows[0].boxes, 11);
  assert.equal(report.rows[0].loose_units, 0);
});

test('cubagem explícita do SKU simples prevalece sobre estimativa de kit', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: '213877',
      product: 'POTE DE VIDRO MARMITA - BRANCO - 640ML',
      description: 'POTE DE VIDRO MARMITA - BRANCO - 640ML', quantity: 60,
      expansion_sources: ['kit:213969'] }],
  }, { profiles: [{ display_name: 'KIT 5X POTE 640ML (TAMPADO)', units_per_box: 6 }],
    mappings: [{ olist_sku: '213877', display_name: 'Pote 640', units_per_sale: 1, units_per_box: 20 }] }, context);
  assert.equal(report.rows[0].boxes, 3);
  assert.equal(report.rows[0].mapping_source, 'SKU Olist');
});

test('perfil de kit associado a pote simples não usa a capacidade do kit como caixa física', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: '215789',
      product: 'POTE DE VIDRO MARMITA - VERMELHO - 370ML',
      description: 'POTE DE VIDRO MARMITA - VERMELHO - 370ML', quantity: 505 }],
  }, { profiles: [{ display_name: 'KIT 3X POTE 370ML (TAMPADO)', units_per_box: 16 }],
    mappings: [{ olist_sku: '215789', display_name: 'KIT 3X POTE 370ML (TAMPADO)',
      units_per_sale: 1, units_per_box: 16 }] }, context);
  assert.equal(report.rows[0].boxes, 10);
  assert.equal(report.rows[0].loose_units, 25);
  assert.equal(report.rows[0].mapping_source, 'capacidade conservadora dos perfis de kit');
});

test('kit sem composição mantém aviso e cálculo legado', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: 'K', product: 'KIT X',
      description: 'KIT X · KIT SEM COMPOSIÇÃO NO OLIST', quantity: 2,
      kit_without_components: true, expansion_sources: ['kit_sem_composicao:K'] }],
  }, { mappings: [] }, context);
  assert.equal(report.rows[0].force_print, true);
  const csv = buildOlistMultichannelCsv(report);
  const message = buildOlistMultichannelMessages(report, context)[0].message_text;
  assert.match(csv, /KIT X · KIT SEM COMPOSIÇÃO NO OLIST/);
  assert.match(message, /KIT X · KIT SEM COMPOSIÇÃO NO OLIST/);
  assert.doesNotMatch(csv, /Descritivo/);
  assert.doesNotMatch(message, /Descritivo/);
  assert.equal(csv.trim().split('\n')[0].split(';').length, 5);
});
