import test from 'node:test';
import assert from 'node:assert/strict';
import { adsPrintAnalyze, adsPrintExtract, adsPrintNumber } from './ads-print.js';

const today = '2026-09-30';
const base = {
  metrics: { impressions: 212000, clicks: 2900, ctr: 1.35, items_sold: 233, sales: 21278.11, spend: 2437.69, roas: 8.73 },
  target_roas: 8, budget_mode: 'limited', daily_budget: 400, budget_consumed: 'yes',
  period_start: '2026-09-21', period_end: '2026-09-28', last_optimization: '2026-09-20'
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

test('quatro cenários exigem orçamento e período comparável', () => {
  for (const [budget_consumed,target_roas,scenario] of [['no',8,1],['no',10,2],['yes',10,3],['yes',8,4]]) {
    assert.equal(adsPrintAnalyze({...base,budget_consumed,target_roas}, today).scenario, scenario);
  }
});

test('verba ilimitada, janela antiga e dia corrente não confirmam cenário', () => {
  assert.equal(adsPrintAnalyze({...base,budget_mode:'unlimited'}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,last_optimization:'2026-09-25'}, today).scenario, null);
  assert.equal(adsPrintAnalyze({...base,period_end:today}, today).scenario, null);
});

test('ROAS abaixo do equilíbrio bloqueia proposta de reduzir meta', () => {
  const report = adsPrintAnalyze({...base,budget_consumed:'no',target_roas:10,contribution_margin_pct:10}, today);
  assert.equal(report.scenario, 2);
  assert.ok(report.warnings.some(text=>text.includes('equilíbrio')));
  assert.ok(!report.actions.some(text=>text.includes('teste meta de ROAS')));
});

test('sem gasto não cria cenário por ROAS exibido', () => {
  assert.equal(adsPrintAnalyze({...base,metrics:{spend:0,sales:0,roas:8}}, today).scenario, null);
});

test('mostra tráfego e CPC sem inventar que a foto é a causa', () => {
  const report = adsPrintAnalyze(base, today);
  assert.ok(report.findings.some(line => line.includes('CPC estimado R$ 0,84')));
  assert.ok(report.findings.some(line => line.includes('não prova problema na foto')));
});
