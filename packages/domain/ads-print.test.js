import test from 'node:test';
import assert from 'node:assert/strict';
import { adsPrintAnalyze, adsPrintExtract, adsPrintNumber } from './ads-print.js';

const today = '2026-10-01';
const base = {
  metrics: { impressions: 212000, clicks: 2900, ctr: 1.35, items_sold: 233, sales: 21278.11, spend: 2437.69, roas: 8.73 },
  target_roas: 8, period_start: '2026-09-21', period_end: '2026-09-28',
  previous_period_start: '2026-09-13', previous_period_end: '2026-09-20',
  previous_impressions: 180000, previous_clicks: 2500,
  last_optimization: '2026-09-20', contribution_margin_pct: 20
};

test('interpreta números brasileiros e cards por posição sem confundir legenda', () => {
  assert.equal(adsPrintNumber('R$21.278,11'), 21278.11);
  assert.equal(adsPrintNumber('2.9k'), 2900);
  const words = [
    {text:'Vendas',x:.82,y:.19},{text:'R$21.278,11',x:.82,y:.24},
    {text:'Investimento',x:.05,y:.37},{text:'R$2.437,69',x:.05,y:.41},
    {text:'ROAS',x:.24,y:.37},{text:'8,73',x:.24,y:.41},
    {text:'ROAS',x:.69,y:.53},
    {text:'21/09',x:.69,y:.07},{text:'-',x:.72,y:.07},{text:'28/09',x:.73,y:.07}
  ];
  const result = adsPrintExtract(words);
  assert.equal(result.metrics.sales, 21278.11);
  assert.equal(result.metrics.spend, 2437.69);
  assert.equal(result.metrics.roas, 8.73);
  assert.deepEqual(result.period, {start:'21/09',end:'28/09'});
});

test('quatro cenários cruzam meta de ROAS e crescimento de impressões com verba ilimitada', () => {
  for (const [previous_impressions,target_roas,scenario] of [[180000,8,1],[200000,8,2],[180000,10,3],[200000,10,4]]) {
    const report = adsPrintAnalyze({...base,previous_impressions,target_roas}, today);
    assert.equal(report.scenario, scenario);
    assert.ok(report.actions.every(line=>!line.includes('orçamento') && !line.includes('teto diário')));
  }
});

test('janela incompleta, curta ou sem comparativo equivalente não confirma cenário', () => {
  assert.equal(adsPrintAnalyze({...base,last_optimization:'2026-09-25'}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,period_end:today}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,period_start:'2026-09-27'}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,previous_period_start:'2026-09-14'}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,previous_impressions:0}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,previous_period_start:'2026-02-30'}, today).scenario, null);
});

test('ROAS abaixo do equilíbrio bloqueia proposta de reduzir meta', () => {
  const report = adsPrintAnalyze({...base,previous_impressions:200000,target_roas:10,contribution_margin_pct:10}, today);
  assert.equal(report.scenario, 4);
  assert.ok(report.warnings.some(text=>text.includes('equilíbrio')));
  assert.ok(!report.actions.some(text=>text.includes('teste reduzir')));
});

test('sem margem ou sem espaço acima do equilíbrio não inventa meta menor', () => {
  const withoutMargin = adsPrintAnalyze({...base,previous_impressions:200000,contribution_margin_pct:''}, today);
  assert.equal(withoutMargin.scenario, 2);
  assert.ok(!withoutMargin.actions.some(text=>text.includes('teste reduzir')));
  const bounded = adsPrintAnalyze({...base,previous_impressions:200000,target_roas:6,contribution_margin_pct:18}, today);
  assert.equal(bounded.scenario, 2);
  assert.ok(!bounded.actions.some(text=>text.includes('teste reduzir')));
  const profitable = adsPrintAnalyze({...base,previous_impressions:200000}, today);
  assert.ok(profitable.actions.some(text=>text.includes('7,20×')));
});

test('sem gasto não cria cenário por ROAS exibido', () => {
  assert.equal(adsPrintAnalyze({...base,metrics:{spend:0,sales:0,roas:8}}, today).scenario, null);
});

test('mostra tráfego e CPC sem inventar que a foto é a causa', () => {
  const report = adsPrintAnalyze(base, today);
  assert.ok(report.findings.some(line => line.includes('CPC estimado R$ 0,84')));
  assert.ok(report.findings.some(line => line.includes('não prova problema na foto')));
  assert.ok(report.findings.some(line => line.includes('Impressões +17,8%')));
});

test('mais impressões sem mais cliques alerta sobre queda de atração', () => {
  const report = adsPrintAnalyze({...base,previous_clicks:3200}, today);
  assert.equal(report.scenario, 1);
  assert.ok(report.warnings.some(line=>line.includes('cliques não acompanharam')));
});
