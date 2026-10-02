'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { operationHref, operationById } from '@oraculo/domain/operations.js';
import { OperationLink as Link } from '../components/operation-provider';
import { SortableTable } from '../components/sortable-table';
import type { BiaReply } from '../../lib/bia/types';

type Message = { id: number; question: string; reply?: BiaReply; error?: string };
const STARTERS = [
  { title: 'Acompanhar faturamento', question: 'Quanto faturamos este mês?' },
  { title: 'Encontrar os destaques', question: 'Top 10 produtos mais vendidos da Shopee no mês passado' },
  { title: 'Conferir a margem', question: 'Quais produtos têm margem abaixo de 15% este mês?' }
];
const timestamp = (value: string | null) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
  : 'Sem atualização disponível';

function Reply({ reply }: { reply: BiaReply }) {
  return <div className="bia-answer">
    <p className="bia-answer-text">{reply.text}</p>
    {reply.metrics ? <div className="bia-metrics">{reply.metrics.map((metric) => <div key={metric.label}>
      <span>{metric.label}</span><strong>{metric.value}</strong>{metric.caption ? <small>{metric.caption}</small> : null}
    </div>)}</div> : null}
    {reply.table ? <section className="bia-result-table"><h3>{reply.table.title}</h3>
      <SortableTable columns={reply.table.columns} rows={reply.table.rows} initialSort={reply.table.initialSort} initialDir="desc" />
    </section> : null}
    {reply.notices?.length ? <div className="bia-notices" aria-label="Critérios e cobertura dos dados">
      {reply.notices.map((notice) => <p key={notice}>{notice}</p>)}
    </div> : null}
    {reply.source ? <footer className="bia-source">
      <div><strong>{reply.source.label}</strong><span>{reply.source.channel} · {reply.source.period}</span><small>Atualização: {timestamp(reply.source.updatedAt)}</small></div>
      <nav aria-label="Conferir fonte" className="bia-source-links">{(reply.source.links ?? [{ label: 'Conferir na tela', href: reply.source.href }]).map((link) =>
        <Link key={link.href} href={link.href} prefetch={false}>{link.label} <span aria-hidden="true">↗</span></Link>)}</nav>
    </footer> : null}
  </div>;
}

export function BiaChat({ operation, dataAllowed, aiConfigured, compact = false }: { operation: string; dataAllowed: boolean; aiConfigured: boolean; compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Entendendo sua pergunta…');
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const lastId = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!messages.length) thread.current?.scrollTo({ top: 0 });
    else if (end.current?.getClientRects().length) end.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, pending]);

  async function send(question: string) {
    question = question.trim();
    if (!question || question.length > 700 || busy.current || !dataAllowed) return;
    busy.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const id = ++lastId.current;
    const questions = [...messages.map((message) => message.question), question].slice(-8);
    setMessages((previous) => [...previous, { id, question }]);
    setInput('');
    setPending(true);
    setStatus('Entendendo sua pergunta…');
    const progress = setTimeout(() => setStatus('Conferindo os dados do Oráculo…'), 2_000);
    const timeout = setTimeout(() => abort.abort('timeout'), 55_000);
    try {
      const response = await fetch(operationHref('/bia/responder', operation), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ questions }), signal: abort.signal
      });
      if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
      const payload = await response.json() as BiaReply & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'A consulta não pôde ser concluída.');
      if (typeof payload.text !== 'string') throw new Error('A resposta não pôde ser lida. Tente novamente.');
      setMessages((previous) => previous.map((message) => message.id === id ? { ...message, reply: payload } : message));
    } catch (error) {
      if (abort.signal.aborted && abort.signal.reason !== 'timeout') return;
      setMessages((previous) => previous.map((message) => message.id === id ? { ...message,
        error: abort.signal.aborted ? 'A consulta demorou mais que o esperado. Tente novamente em instantes.' : error instanceof Error ? error.message : 'Não consegui concluir a consulta.' } : message));
    } finally {
      clearTimeout(progress); clearTimeout(timeout);
      if (controller.current === abort) { setPending(false); busy.current = false; if (textarea.current?.getClientRects().length) textarea.current.focus(); }
    }
  }

  function reset() {
    controller.current?.abort();
    controller.current = null;
    busy.current = false;
    setPending(false); setMessages([]); setInput('');
    textarea.current?.focus();
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }

  return <div className={compact ? 'bia-workspace bia-workspace-compact' : 'bia-workspace'}>
    <div className="bia-context"><span><i aria-hidden="true" /> {operationById(operation)?.label}</span>
      <button type="button" className="bia-reset" onClick={reset} disabled={!messages.length}>Nova conversa <span aria-hidden="true">↺</span></button>
    </div>
    <div className="bia-thread" ref={thread}>
    {!dataAllowed ? <section className="panel bia-access" role="status"><h2>Seu acesso aos dados precisa ser liberado</h2>
      <p>Para consultar faturamento, produtos e margem, peça ao administrador acesso à Análise Comercial nesta operação.</p>
    </section> : null}
    {messages.length === 0 ? <section className="panel bia-welcome">
      <div className="bia-welcome-copy"><p className="eyebrow">Prazer, sou a B.ia</p><h2>{compact ? 'Como posso ajudar?' : <>O que você quer<br />descobrir hoje?</>}</h2>
        <p>{compact ? 'Pergunte sobre faturamento, produtos e margem. Eu consulto os dados para você.' : 'Pergunte sobre faturamento, produtos e margem. Eu consulto os dados e mostro o caminho para você conferir.'}</p>
        <span className="bia-promise">Seus dados continuam como estão. Eu apenas respondo.</span>
      </div>
      <img className="bia-character" src="/brand/bia/personagem.png" alt="B.ia, uma assistente robótica com detalhes dourados e olhos em ciano" width="1280" height="1280" />
      <div className="bia-starters">{STARTERS.map((starter, index) => <button key={starter.title} type="button" onClick={() => void send(starter.question)} disabled={!dataAllowed}>
        <span className="bia-starter-index">0{index + 1}</span><strong>{starter.title}</strong><span>{starter.question}</span><b aria-hidden="true">↗</b>
      </button>)}</div>
    </section> : <section className="bia-conversation" aria-label="Conversa com a B.ia" aria-busy={pending}>
      {messages.map((message) => <article key={message.id} className="bia-turn">
        <div className="bia-question"><span>Você</span><p>{message.question}</p></div>
        <div className="bia-reply-row"><img src="/brand/bia/personagem.png" width="48" height="48" alt="" />
          <div className="bia-reply-body"><div className="bia-reply-label"><strong>B.ia</strong>
            {message.reply?.source ? <span>{message.reply.mode === 'local' ? 'Leitura com IA · dados verificados' : 'Consulta verificada'}</span> : null}
          </div>
          {message.reply ? <Reply reply={message.reply} /> : message.error ? <p className="bia-error" role="alert">{message.error}</p>
            : <p className="bia-pending" role="status"><span aria-hidden="true">•••</span> {status}</p>}
          </div>
        </div>
      </article>)}
      <div ref={end} />
    </section>}
    </div>
    <form className="bia-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="bia-question">Sua pergunta para a B.ia</label>
      <textarea ref={textarea} id="bia-question" value={input} onChange={(event) => setInput(event.target.value)} maxLength={700} rows={2}
        placeholder="Pergunte à B.ia…" disabled={pending || !dataAllowed} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <button type="submit" disabled={pending || !input.trim() || !dataAllowed} aria-label="Enviar pergunta" title="Enviar pergunta">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      <div className="bia-composer-caption"><span>{compact ? 'Conversa temporária · Nova conversa limpa o contexto.' : 'A conversa fica apenas nesta página. Nova conversa limpa o contexto.'}</span>
        <span>{aiConfigured ? 'Somente leitura' : 'Consultas verificadas disponíveis · IA indisponível'}</span>
      </div>
    </form>
  </div>;
}
