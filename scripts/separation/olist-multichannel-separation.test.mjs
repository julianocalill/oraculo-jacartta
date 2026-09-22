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

test('kit sem composição mantém aviso e cálculo legado', () => {
  const report = buildOlistMultichannelReport({
    quantity_semantics: 'physical_components', rows: [{ sku: 'K', product: 'KIT X',
      description: 'KIT X · KIT SEM COMPOSIÇÃO NO OLIST', quantity: 2,
      kit_without_components: true, expansion_sources: ['kit_sem_composicao:K'] }],
  }, { mappings: [] }, context);
  assert.equal(report.rows[0].force_print, true);
  assert.match(buildOlistMultichannelCsv(report), /KIT SEM COMPOSIÇÃO NO OLIST/);
});
