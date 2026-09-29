"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchOption = { value: string; label: string };

const MAX_RESULTS = 60;

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Campo que aceita digitação e filtra as opções (combobox). Cada palavra digitada
// precisa aparecer no rótulo, em qualquer ordem, sem diferenciar acento/caixa.
// O texto livre nunca vira valor: só uma opção escolhida da lista é gravada.
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  required
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const indexed = useMemo(() => options.map((option) => {
    const haystack = normalize(option.label);
    return { option, haystack, words: haystack.split(/[^a-z0-9]+/).filter(Boolean) };
  }), [options]);
  const matches = useMemo(() => {
    const typed = selected && query === selected.label ? "" : query;
    const tokens = normalize(typed).split(/\s+/).filter(Boolean);
    if (!tokens.length) return { total: indexed.length, shown: indexed.slice(0, MAX_RESULTS).map((entry) => entry.option) };
    // Palavra inteira vale mais que começo de palavra, que vale mais que trecho no meio
    // ("gg" deve trazer o tamanho GG antes de "leGGing").
    const found = indexed
      .filter((entry) => tokens.every((token) => entry.haystack.includes(token)))
      .map((entry) => ({
        entry,
        score: tokens.reduce((sum, token) => sum + (entry.words.includes(token) ? 2 : entry.words.some((word) => word.startsWith(token)) ? 1 : 0), 0)
      }))
      .sort((a, b) => b.score - a.score);
    return { total: found.length, shown: found.slice(0, MAX_RESULTS).map(({ entry }) => entry.option) };
  }, [indexed, query, selected]);

  // Mantém o texto alinhado ao valor quando ele muda por fora (sugestão do de-para, troca de loja).
  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "");
  }, [selected?.label, open]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Escolha um item da lista." : "");
  }, [required, value]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(option: SearchOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    // O foco continua no campo: deixa o texto selecionado para a próxima digitação substituir, não emendar.
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function close() {
    setOpen(false);
    setQuery(selected?.label ?? "");
  }

  return (
    <div className="search-select">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={(event) => { setOpen(true); setActive(0); event.currentTarget.select(); }}
        onBlur={close}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.max(0, Math.min(current + 1, matches.shown.length - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = matches.shown[active];
            if (option) pick(option);
          } else if (event.key === "Escape") {
            close();
          }
        }}
      />
      {open ? (
        <ul className="search-select-list" id={listId} role="listbox" ref={listRef}>
          {matches.shown.length ? matches.shown.map((option, index) => (
            <li
              key={option.value}
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              className={index === active ? "is-active" : undefined}
              onMouseDown={(event) => { event.preventDefault(); pick(option); }}
              onMouseEnter={() => setActive(index)}
            >
              {option.label}
            </li>
          )) : <li className="search-select-empty">Nenhum item encontrado.</li>}
          {matches.total > matches.shown.length ? (
            <li className="search-select-empty">Mostrando {matches.shown.length} de {matches.total}. Digite mais para refinar.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
