import test from 'node:test';
import assert from 'node:assert/strict';
import { adsPeriod, adsTotals, adsRatio, adsDelta, adsSignal } from './ads-analysis.js';
const metrics = (overrides={})=>({ expense:100,direct_gmv:500,direct_orders:5,impressions:2000,clicks:100,broad_gmv:700,...overrides });
test('ROAS consolidado pondera por gasto e não soma halo',()=>{
  const total=adsTotals([metrics(),metrics({expense:900,direct_gmv:900})]);
  assert.equal(adsRatio(total.direct_gmv,total.expense),1.4);
  assert.equal(adsRatio(100,0),null);
  assert.equal(adsDelta(100,0),null);
});
test('datas fechadas em BRT, anteriores de mesma duração e calendário real',()=>{
  const p=adsPeriod(undefined,undefined,'2026-09-11');
  assert.equal(p.start,'2026-08-12'); assert.equal(p.end,'2026-09-10'); assert.equal(p.days,30);
  assert.equal(p.previousStart,'2026-07-13'); assert.equal(p.previousEnd,'2026-08-11');
  for(const [s,e] of [['2026-02-30','2026-03-01'],['2026-09-11','2026-09-11'],['2026-09-10','2026-09-09'],['2026-01-01','2026-09-10']]) assert.ok(adsPeriod(s,e,'2026-09-11').error);
});
test('prioridade crítica domina oportunidade e exige limiar de gasto',()=>{
  assert.equal(adsSignal(metrics({direct_orders:0}),metrics(),1).level,'Crítica');
  assert.equal(adsSignal(metrics({expense:99,direct_gmv:0,direct_orders:0}),metrics(),0,false).level,'Acompanhar');
  assert.equal(adsSignal(metrics({direct_gmv:200}),metrics(),5).level,'Crítica');
});
test('sem cobertura anterior não inventa tendência ou oportunidade',()=>{
  const c=metrics({expense:140,direct_gmv:400});
  assert.equal(adsSignal(c,metrics(),0,true).level,'Crítica');
  assert.equal(adsSignal(c,metrics(),0,false).level,'Acompanhar');
  assert.equal(adsSignal(metrics({direct_gmv:600}),metrics(),5,false).level,'Acompanhar');
});
test('oportunidade exige atividade, meta e comparação com base',()=>{
  assert.equal(adsSignal(metrics({direct_gmv:600}),metrics(),5).level,'Oportunidade');
  assert.equal(adsSignal(metrics({direct_gmv:600}),metrics(),5,true,false).level,'Acompanhar');
  assert.equal(adsSignal(metrics({direct_gmv:600}),metrics(),0).level,'Acompanhar');
  assert.notEqual(adsSignal(metrics({direct_gmv:600}),metrics({direct_gmv:1000}),5).level,'Oportunidade');
});
test('impressões interrompidas não acusam campanhas já pausadas',()=>{
  const c=metrics({expense:0,direct_orders:0,direct_gmv:0,clicks:0,impressions:0});
  assert.equal(adsSignal(c,metrics(),0,true,true).level,'Crítica');
  assert.equal(adsSignal(c,metrics(),0,true,false).level,'Acompanhar');
});
