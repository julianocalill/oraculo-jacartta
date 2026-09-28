"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export type OperationChoice = { id: string; label: string; href: string };

// Seletor de operação no topo da sidebar (substitui o link "Trocar operação",
// que era ouro claro sobre branco e quase ilegível). Botão em cápsula com a
// operação atual; abre uma lista com as operações liberadas ao usuário.
// <details> nativo faz abrir/fechar; o JS só fecha ao clicar fora, no Esc e
// ao navegar. Os hrefs já vêm prontos do servidor (/o/<op>/<primeira aba
// liberada>), por isso é Link comum e não OperationLink — este reescreveria
// para a operação atual.
export function OperationSwitcher({ current, options }: { current: OperationChoice; options: OperationChoice[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    function close(event: Event) {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) {
        details.removeAttribute("open");
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const pin = (
    <svg className="operation-pin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );

  // Uma operação só: mostra onde está, sem menu.
  if (options.length <= 1) {
    return (
      <div className="operation-switcher operation-switcher-static">
        {pin}
        <span className="operation-switcher-text">
          <small>Operação</small>
          <strong>{current.label}</strong>
        </span>
      </div>
    );
  }

  return (
    <details className="operation-switcher" ref={ref}>
      <summary aria-label={`Operação atual: ${current.label}. Trocar operação`}>
        {pin}
        <span className="operation-switcher-text">
          <small>Operação</small>
          <strong>{current.label}</strong>
        </span>
        <svg className="operation-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </summary>
      <div className="operation-menu" role="menu">
        {options.map((option) => {
          const active = option.id === current.id;
          return (
            <Link
              key={option.id}
              href={option.href}
              prefetch={false}
              role="menuitemradio"
              aria-checked={active}
              className={active ? "is-current" : undefined}
            >
              <span>{option.label}</span>
              {active ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              ) : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}
