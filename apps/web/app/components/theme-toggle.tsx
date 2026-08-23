"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "../../lib/theme";

// Seletor Escuro/Claro da sidebar. A escolha vai para um cookie de 1 ano:
// o layout lê o cookie no servidor e já manda o <html data-theme> correto,
// então não há flash de tema errado no carregamento. O atributo também é
// trocado no cliente na hora do clique, sem esperar navegação.
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Tema da interface">
      <button
        type="button"
        role="radio"
        aria-checked={theme === "dark"}
        className={theme === "dark" ? "is-active" : undefined}
        onClick={() => choose("dark")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
        Escuro
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={theme === "light"}
        className={theme === "light" ? "is-active" : undefined}
        onClick={() => choose("light")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        Claro
      </button>
    </div>
  );
}
