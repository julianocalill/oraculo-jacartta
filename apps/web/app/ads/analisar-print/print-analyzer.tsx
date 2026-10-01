"use client";

import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { adsPrintAnalyze, adsPrintExtract } from '@oraculo/domain/ads-print.js';

const MAX_IMAGE = 10 * 1024 * 1024;
const keys = ['impressions', 'clicks', 'ctr', 'items_sold', 'sales', 'spend', 'roas'] as const;
type MetricKey = typeof keys[number];
type Metrics = Record<MetricKey, string>;
type Reading = ReturnType<typeof adsPrintExtract>;
type Report = ReturnType<typeof adsPrintAnalyze>;

const metricLabels: Record<MetricKey, string> = {
  impressions: 'Impressões', clicks: 'Cliques', ctr: 'CTR (%)', items_sold: 'Itens vendidos',
  sales: 'Vendas atribuídas (R$)', spend: 'Investimento (R$)', roas: 'ROAS exibido (×)'
};
const emptyMetrics = (): Metrics => ({ impressions:'', clicks:'', ctr:'', items_sold:'', sales:'', spend:'', roas:'' });

function dayMonth(value: string, year: number) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function periodFromPrint(period: Reading['period'], today: string) {
  if (!period) return { start:'', end:'' };
  const year = Number(today.slice(0,4));
  let end = dayMonth(period.end, year);
  if (!end) return { start:'', end:'' };
  if (end > today) end = dayMonth(period.end, year - 1) ?? end;
  let start = dayMonth(period.start, Number(end.slice(0,4)));
  if (start && start > end) start = dayMonth(period.start, Number(end.slice(0,4)) - 1);
  return { start: start ?? '', end };
}

function precedingPeriod(start: string, end: string) {
  if (!start || !end || start > end) return { start:'', end:'' };
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
  const previousEnd = new Date(Date.parse(`${start}T12:00:00Z`) - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  return { start:previousStart.toISOString().slice(0,10), end:previousEnd.toISOString().slice(0,10) };
}

async function imageDimensions(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{width:number;height:number}>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('Não foi possível abrir o print.'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

function MetricInput({ id, value, onChange }: { id:MetricKey; value:string; onChange:(id:MetricKey,value:string)=>void }) {
  return <label><span>{metricLabels[id]}</span><input inputMode="decimal" value={value} onChange={event=>onChange(id,event.target.value)} /></label>;
}

export function AdsPrintAnalyzer({ today }: { today: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [target, setTarget] = useState('');
  const [optimized, setOptimized] = useState('');
  const [previousStart, setPreviousStart] = useState('');
  const [previousEnd, setPreviousEnd] = useState('');
  const [previousImpressions, setPreviousImpressions] = useState('');
  const [previousClicks, setPreviousClicks] = useState('');
  const [contribution, setContribution] = useState('');
  const [store, setStore] = useState('');
  const [item, setItem] = useState('');
  const [priceChanged, setPriceChanged] = useState(false);
  const [lowStock, setLowStock] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(selected: File | null) {
    if (!selected) return;
    if (!['image/png','image/jpeg'].includes(selected.type) || selected.size > MAX_IMAGE) {
      setError('Envie um print PNG ou JPEG de até 10 MB.');
      return;
    }
    setError(''); setFile(selected); setPreview(URL.createObjectURL(selected));
    setReading(null); setReport(null); setOcrText(''); setMetrics(emptyMetrics());
    setPeriodStart(''); setPeriodEnd('');
    setPreviousStart(''); setPreviousEnd(''); setPreviousImpressions(''); setPreviousClicks('');
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    choose(event.dataTransfer.files.item(0));
  }

  function currentInput(nextMetrics = metrics, nextStart = periodStart, nextEnd = periodEnd,
    nextPreviousStart = previousStart, nextPreviousEnd = previousEnd) {
    return { metrics: nextMetrics, target_roas: target, period_start: nextStart, period_end: nextEnd,
      previous_period_start: nextPreviousStart, previous_period_end: nextPreviousEnd,
      previous_impressions: previousImpressions, previous_clicks: previousClicks,
      last_optimization: optimized, contribution_margin_pct: contribution,
      recent_price_change: priceChanged, low_stock: lowStock };
  }

  async function readPrint() {
    if (!file || busy) return;
    setBusy(true); setError(''); setProgress('Preparando o OCR no navegador…');
    let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;
    try {
      const dimensions = await imageDimensions(file);
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('por', 1, {
        workerPath:'/ads-ocr/worker.min.js', corePath:'/ads-ocr/core', langPath:'/ads-ocr/lang',
        logger: event => { if (event.status === 'recognizing text') setProgress(`Lendo o print… ${Math.round(event.progress * 100)}%`); }
      });
      const result = await worker.recognize(file, {}, { blocks:true });
      const words = (result.data.blocks ?? []).flatMap(block=>block.paragraphs ?? [])
        .flatMap(paragraph=>paragraph.lines ?? []).flatMap(line=>line.words ?? [])
        .map(word=>({ text:word.text, x:word.bbox.x0 / dimensions.width, y:word.bbox.y0 / dimensions.height }));
      const parsed = adsPrintExtract(words);
      const nextMetrics = Object.fromEntries(keys.map(key=>[key, parsed.metrics[key] == null ? '' : String(parsed.metrics[key]).replace('.', ',')])) as Metrics;
      const period = periodFromPrint(parsed.period, today);
      const previous = precedingPeriod(period.start, period.end);
      setMetrics(nextMetrics); setReading(parsed); setOcrText(result.data.text);
      if (period.start) setPeriodStart(period.start);
      if (period.end) setPeriodEnd(period.end);
      if (previous.start) setPreviousStart(previous.start);
      if (previous.end) setPreviousEnd(previous.end);
      setReport(adsPrintAnalyze(currentInput(nextMetrics, period.start || periodStart, period.end || periodEnd,
        previous.start || previousStart, previous.end || previousEnd), today));
      setProgress('Leitura concluída. Confira os valores antes de usar as sugestões.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reconhecer o print. Tente outro arquivo ou navegador.');
      setProgress('');
    } finally {
      if (worker) await worker.terminate();
      setBusy(false);
    }
  }

  function updateReport() { setReport(adsPrintAnalyze(currentInput(), today)); }

  async function copyReport() {
    if (!report) return;
    const text = [
      `Shopee Ads${store ? ` · ${store}` : ''}${item ? ` · ${item}` : ''}`,
      report.scenario_name, '', 'Leitura:', ...report.findings.map(line=>`- ${line}`),
      '', 'Sugestões:', ...report.actions.map(line=>`- ${line}`),
      ...(report.warnings.length ? ['', 'Atenção:', ...report.warnings.map(line=>`- ${line}`)] : []),
      ...(report.missing.length ? ['', 'Falta confirmar:', ...report.missing.map(line=>`- ${line}`)] : [])
    ].join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false), 1800); }
    catch { setError('Não foi possível copiar a análise neste navegador.'); }
  }

  return <div className="ads-print">
    <section className="panel ads-print-panel">
      <div className="section-head"><div><p className="eyebrow">01 · Captura</p><h2>Envie o print do anúncio</h2></div><span className="pill">PNG ou JPEG · até 10 MB</span></div>
      <div className="ads-print-upload-grid">
        <label className="ads-print-drop" onDragOver={event=>event.preventDefault()} onDrop={drop}>
          <input type="file" accept="image/png,image/jpeg" onChange={(event:ChangeEvent<HTMLInputElement>)=>choose(event.target.files?.item(0) ?? null)} aria-label="Selecionar print Shopee Ads" />
          <span className="ads-print-drop-icon" aria-hidden="true">↑</span><strong>Arraste o print ou clique para escolher</strong><small>A imagem é processada no navegador e não é enviada ao servidor.</small>
        </label>
        <div className="ads-print-preview">{preview?<img src={preview} alt="Prévia do print selecionado" />:<span>Prévia do print</span>}</div>
      </div>
      <div className="ads-print-toolbar"><span>{file ? `${file.name} · ${(file.size/1024/1024).toFixed(1)} MB` : 'Nenhum arquivo selecionado'}</span><button type="button" onClick={readPrint} disabled={!file || busy}>{busy?'Lendo print…':'Ler print e gerar análise'}</button></div>
      {progress?<p className="commercial-muted" role="status">{progress}</p>:null}
      {error?<p className="ads-print-error" role="alert">{error}</p>:null}
    </section>

    <section className="panel ads-print-panel">
      <div className="section-head"><div><p className="eyebrow">Matriz · verba ilimitada</p><h2>Os quatro cenários</h2></div></div>
      <p className="commercial-muted">Entrega significa crescimento de pelo menos 10% nas impressões frente a um período anterior de igual duração. Esse corte é um critério de análise do Oráculo, não uma regra da Shopee.</p>
      <div className="ads-print-report-grid">
        <article><small>01 / ROAS NA META · ENTREGA CRESCE</small><h3>Manter e acompanhar</h3><p>Confira se cliques e margem acompanham o alcance. Evite mudar uma campanha que está avançando.</p></article>
        <article><small>02 / ROAS NA META · ENTREGA NÃO CRESCE</small><h3>Testar mais alcance</h3><p>Se a margem permitir, teste reduzir apenas a meta de ROAS em até 10% e compare a próxima janela.</p></article>
        <article><small>03 / ROAS ABAIXO · ENTREGA CRESCE</small><h3>Corrigir retorno</h3><p>Revise CTR, conversão e oferta antes de buscar mais exposição.</p></article>
        <article><small>04 / ROAS ABAIXO · ENTREGA NÃO CRESCE</small><h3>Investigar restrições</h3><p>Compare meta, histórico e margem. Ajuste a oferta antes de abrir a entrega quando o retorno não sustenta o gasto.</p></article>
      </div>
    </section>

    <section className="panel ads-print-panel" hidden={!reading}>
      <div className="section-head"><div><p className="eyebrow">02 · Conferência</p><h2>Valide os dados lidos</h2></div><span className="pill">{reading?.recognized_words ?? 0} palavras lidas</span></div>
      <p className="commercial-muted">Valores abreviados, como “2,9k”, são aproximados. Corrija o que o OCR tiver lido errado.</p>
      <div className="ads-print-fields ads-print-metrics">{keys.map(key=><MetricInput key={key} id={key} value={metrics[key]} onChange={(id,value)=>setMetrics(current=>({...current,[id]:value}))}/>)}</div>
      <details className="ads-print-ocr"><summary>Ver texto reconhecido</summary><pre>{ocrText}</pre></details>
    </section>

    <section className="panel ads-print-panel" hidden={!reading}>
      <div className="section-head"><div><p className="eyebrow">03 · Contexto</p><h2>Complete o que o print não mostra</h2></div></div>
      <p className="commercial-muted">Orçamento ilimitado em todas as campanhas. Os quatro cenários cruzam ROAS versus meta com o crescimento das impressões em relação a um período anterior equivalente.</p>
      <div className="ads-print-fields">
        <label><span>Loja <small>opcional</small></span><input value={store} onChange={event=>setStore(event.target.value)} placeholder="Ex.: Donacor" /></label>
        <label><span>Produto ou ID <small>opcional</small></span><input value={item} onChange={event=>setItem(event.target.value)} placeholder="Ex.: 43766973738" /></label>
        <label><span>Início do print</span><input type="date" value={periodStart} max={today} onChange={event=>setPeriodStart(event.target.value)} /></label>
        <label><span>Fim do print</span><input type="date" value={periodEnd} max={today} onChange={event=>setPeriodEnd(event.target.value)} /></label>
        <label><span>Meta de ROAS vigente (×)</span><input inputMode="decimal" value={target} onChange={event=>setTarget(event.target.value)} placeholder="Ex.: 12" /></label>
        <label><span>Última mudança de meta ou oferta</span><input type="date" value={optimized} max={today} onChange={event=>setOptimized(event.target.value)} /></label>
        <label><span>Margem de contribuição antes de Ads (%) <small>recomendada</small></span><input inputMode="decimal" value={contribution} onChange={event=>setContribution(event.target.value)} placeholder="Ex.: 18" /></label>
      </div>
      <h3>Comparação anterior do mesmo anúncio</h3>
      <p className="commercial-muted">Use ao menos sete dias completos após a última otimização e compare com outro período de igual duração. As datas anteriores são sugeridas pelo print; confira antes de analisar.</p>
      <div className="ads-print-fields">
        <label><span>Início anterior</span><input type="date" value={previousStart} max={today} onChange={event=>setPreviousStart(event.target.value)} /></label>
        <label><span>Fim anterior</span><input type="date" value={previousEnd} max={today} onChange={event=>setPreviousEnd(event.target.value)} /></label>
        <label><span>Impressões anteriores</span><input inputMode="numeric" value={previousImpressions} onChange={event=>setPreviousImpressions(event.target.value)} placeholder="Ex.: 180000" /></label>
        <label><span>Cliques anteriores <small>recomendado</small></span><input inputMode="numeric" value={previousClicks} onChange={event=>setPreviousClicks(event.target.value)} placeholder="Ex.: 2500" /></label>
      </div>
      <div className="ads-print-checks"><label><input type="checkbox" checked={priceChanged} onChange={event=>setPriceChanged(event.target.checked)} /> Preço ou frete mudou recentemente</label><label><input type="checkbox" checked={lowStock} onChange={event=>setLowStock(event.target.checked)} /> Estoque baixo</label></div>
      <div className="ads-print-toolbar"><span>Classificação exige períodos comparáveis; nenhum ajuste altera a campanha automaticamente.</span><button type="button" onClick={updateReport}>Atualizar recomendações</button></div>
    </section>

    <section className="panel ads-print-panel" hidden={!report}>
      <div className="section-head"><div><p className="eyebrow">04 · Leitura e ação</p><h2>O que fazer com este anúncio</h2></div><button type="button" className="ads-print-copy" onClick={copyReport}>{copied?'Copiado ✓':'Copiar análise'}</button></div>
      <div className={`ads-print-scenario ${report?.scenario?'':'pending'}`}>{report?.scenario_name}</div>
      <div className="ads-print-report-grid"><article><small>01 / LEITURA</small><h3>O que os dados dizem</h3><ul>{report?.findings.map((line,index)=><li key={index}>{line}</li>)}</ul></article><article><small>02 / PRÓXIMOS PASSOS</small><h3>Sugestões</h3><ol>{report?.actions.map((line,index)=><li key={index}>{line}</li>)}</ol></article></div>
      {report?.warnings.length?<div className="ads-print-notes warning"><h3>Atenção antes de alterar</h3><ul>{report.warnings.map((line,index)=><li key={index}>{line}</li>)}</ul></div>:null}
      {report?.missing.length?<div className="ads-print-notes"><h3>Falta confirmar</h3><ul>{report.missing.map((line,index)=><li key={index}>{line}</li>)}</ul></div>:null}
      <p className="commercial-muted">{report?.basis}</p>
    </section>
  </div>;
}
