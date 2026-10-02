'use client';

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseOperationPath } from '@oraculo/domain/operations.js';
import { tabForPath } from '../../lib/auth/path-tabs';

type BiaConfig = { operation: string; userId: string; allowed: boolean; dataAllowed: boolean; aiConfigured: boolean };
const AccessContext = createContext<((config: BiaConfig) => void) | null>(null);
const Chat = dynamic(() => import('../bia/chat').then((module) => module.BiaChat), {
  ssr: false, loading: () => <p className="bia-dock-loading" role="status">Abrindo sua conversa…</p>
});

// Root layout persists across navigation. Server AppShell sends only access
// metadata. Conversation stays in React memory, never browser storage.
export function BiaProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BiaConfig | null>(null);
  const pathname = usePathname() ?? '';
  const route = parseOperationPath(pathname);
  const currentOperation = route.operation?.id ?? 'uberlandia';
  const register = useCallback((next: BiaConfig) => setConfig((previous) =>
    previous && Object.keys(next).every((key) => previous[key as keyof BiaConfig] === next[key as keyof BiaConfig]) ? previous : next), []);
  const visible = config?.allowed && config.operation === currentOperation && (tabForPath(pathname) || route.path === '/conta');

  return <AccessContext.Provider value={register}>
    {children}
    {visible && config ? <Suspense fallback={null}>
      <BiaDock key={`${config.operation}:${config.userId}:${config.dataAllowed}`} config={config} />
    </Suspense> : null}
  </AccessContext.Provider>;
}

// Revalidated on every authenticated server render. No cleanup on ordinary
// page replacement, which would discard the chat between pages of one scope.
export function BiaAccess(config: BiaConfig) {
  const register = useContext(AccessContext);
  useEffect(() => { register?.(config); }, [register, config.operation, config.userId, config.allowed, config.dataAllowed, config.aiConfigured]);
  return null;
}

function BiaDock({ config }: { config: BiaConfig }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [mobile, setMobile] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const params = useSearchParams();
  const pathname = usePathname();

  function close() { setOpen(false); launcher.current?.focus(); }
  function show() { setStarted(true); setOpen(true); }
  useEffect(() => {
    if (params.get('bia') === '1' || parseOperationPath(pathname ?? '').path === '/bia') {
      setStarted(true); setOpen(true);
    }
  }, [params, pathname]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('.bia-dock-close')?.focus();
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); launcher.current?.focus(); }
      if (mobile && event.key === 'Tab') {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]') ?? [])]
          .filter((element) => element.getClientRects().length > 0);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (mobile) document.body.style.overflow = previousOverflow; };
  }, [open, mobile]);

  return <div className="bia-dock">
    {open && mobile ? <button className="bia-dock-backdrop" type="button" aria-label="Fechar conversa com a B.ia" tabIndex={-1} onClick={close} /> : null}
    <aside ref={panel} id="bia-chat-panel" className="bia-dock-panel" hidden={!open} role="dialog" aria-modal={mobile || undefined} aria-labelledby="bia-dock-title">
      <header className="bia-dock-header">
        <img src="/brand/bia/personagem.png" width="48" height="48" alt="" />
        <div><strong id="bia-dock-title">B.ia</strong><span>Sua assistente de dados <i aria-hidden="true">·</i> Somente leitura</span></div>
        <button type="button" className="bia-dock-close" onClick={close} aria-label="Minimizar conversa com a B.ia" title="Minimizar conversa">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {started ? <Chat operation={config.operation} dataAllowed={config.dataAllowed} aiConfigured={config.aiConfigured} compact /> : null}
    </aside>
    <button ref={launcher} className="bia-launcher" type="button" onClick={() => open ? close() : show()} aria-label={open ? 'Minimizar conversa com a B.ia' : 'Conversar com a B.ia'} aria-expanded={open} aria-controls="bia-chat-panel">
      <img src="/brand/bia/personagem.png" width="60" height="60" alt="" />
      <span><strong>B.ia</strong><small>Vamos conversar?</small></span>
    </button>
  </div>;
}
