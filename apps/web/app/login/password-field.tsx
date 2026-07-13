"use client";

import { useState } from "react";

export function PasswordField({ autoComplete }: { autoComplete: string }) {
  const [show, setShow] = useState(false);

  return (
    <label>
      <span>Senha</span>
      <div className="password-wrap">
        <input
          name="password"
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((value) => !value)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={show}
          title={show ? "Ocultar senha" : "Mostrar senha"}
        >
          {show ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 4.24A9.1 9.1 0 0112 4c5 0 9 4.5 10 8a13.3 13.3 0 01-2.3 3.4M6.1 6.1C3.8 7.5 2.2 9.6 2 12c1 3.5 5 8 10 8a9.7 9.7 0 004.1-.9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M2 12c1-3.5 5-8 10-8s9 4.5 10 8c-1 3.5-5 8-10 8s-9-4.5-10-8z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
