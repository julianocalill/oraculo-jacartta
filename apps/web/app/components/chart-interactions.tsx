"use client";

import { useEffect } from "react";

type Row = { label: string; value: string; color?: string; series?: string };

// Interação de TODOS os gráficos, com um listener global (montado uma vez no
// layout, como o TableColumnHints). Os gráficos seguem renderizados no
// servidor e só declaram atributos:
//
//   data-tip / data-tip-rows  → tooltip com título + linhas (chart-hits.tsx)
//   .chart-hits               → setas ←/→ percorrem os pontos pelo teclado
//   [data-chart] + data-toggle-series="k" → legenda liga/desliga a série k
//   [data-chart][data-link] + data-series="k" → hover realça a série k
//                                                e esmaece as outras
//
// Mouse: hover. Toque: tocar no ponto fixa o tooltip; tocar fora fecha.
export function ChartInteractions() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.setAttribute("role", "status");
    tip.setAttribute("aria-live", "polite");
    tip.hidden = true;
    document.body.append(tip);

    let current: HTMLElement | null = null;

    function rowsOf(el: HTMLElement): Row[] {
      try {
        const rows = JSON.parse(el.dataset.tipRows ?? "[]") as Row[];
        const root = el.closest<HTMLElement>("[data-chart]");
        const hidden = new Set((root?.dataset.hiddenSeries ?? "").split(" ").filter(Boolean));
        return rows.filter((row) => !row.series || !hidden.has(row.series));
      } catch {
        return [];
      }
    }

    function render(el: HTMLElement) {
      tip.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = el.dataset.tip ?? "";
      tip.append(title);
      for (const row of rowsOf(el)) {
        const line = document.createElement("span");
        line.className = "chart-tooltip-row";
        const name = document.createElement("span");
        if (row.color) {
          const sw = document.createElement("i");
          sw.style.background = row.color;
          name.append(sw);
        }
        name.append(row.label);
        const value = document.createElement("b");
        value.textContent = row.value;
        line.append(name, value);
        tip.append(line);
      }
      if (el.dataset.tipNote) {
        const note = document.createElement("small");
        note.textContent = el.dataset.tipNote;
        tip.append(note);
      }
    }

    function place(x: number, y: number) {
      const gap = 14;
      const { width, height } = tip.getBoundingClientRect();
      let left = x + gap;
      let top = y - height - gap;
      if (left + width > window.innerWidth - 8) left = x - width - gap;
      if (left < 8) left = 8;
      if (top < 8) top = y + gap;
      if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    function show(el: HTMLElement, x?: number, y?: number) {
      if (current && current !== el) current.classList.remove("is-active");
      current = el;
      el.classList.add("is-active");
      render(el);
      tip.hidden = false;
      if (x == null || y == null) {
        const rect = el.getBoundingClientRect();
        const guide = el.querySelector<HTMLElement>(".chart-guide");
        const gx = guide ? guide.getBoundingClientRect().left : rect.left + rect.width / 2;
        place(gx, rect.top + Math.min(rect.height / 3, 60));
      } else {
        place(x, y);
      }
    }

    function hide() {
      current?.classList.remove("is-active");
      current = null;
      tip.hidden = true;
    }

    // ---- realce de série ligado (legenda ↔ fatia/barra) ----
    function linkHighlight(el: Element | null) {
      const root = el?.closest<HTMLElement>("[data-chart][data-link]");
      const key = el?.closest<HTMLElement>("[data-series]")?.dataset.series;
      document.querySelectorAll<HTMLElement>("[data-chart][data-link].is-linking").forEach((other) => {
        if (other === root && key) return;
        other.classList.remove("is-linking");
        other.querySelectorAll(".is-linked").forEach((n) => n.classList.remove("is-linked"));
      });
      if (!root || !key) return;
      root.classList.add("is-linking");
      root.querySelectorAll<HTMLElement>("[data-series]").forEach((n) => {
        n.classList.toggle("is-linked", n.dataset.series === key);
      });
    }

    function onOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = event.target as Element;
      linkHighlight(target);
      const el = target.closest<HTMLElement>("[data-tip]");
      if (el) show(el, event.clientX, event.clientY);
      else if (current) hide();
    }

    function onMove(event: PointerEvent) {
      if (event.pointerType === "touch" || !current || tip.hidden) return;
      place(event.clientX, event.clientY);
    }

    function onLeaveWindow(event: PointerEvent) {
      if (!event.relatedTarget) {
        hide();
        linkHighlight(null);
      }
    }

    function onDown(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      const target = event.target as Element;
      const el = target.closest<HTMLElement>("[data-tip]");
      linkHighlight(target);
      if (el) show(el, event.clientX, event.clientY);
      else hide();
    }

    // ---- legenda: liga/desliga série ----
    function onClick(event: MouseEvent) {
      const button = (event.target as Element).closest<HTMLElement>("[data-toggle-series]");
      if (!button) return;
      const root = button.closest<HTMLElement>("[data-chart]");
      const key = button.dataset.toggleSeries;
      if (!root || !key) return;
      const hidden = new Set((root.dataset.hiddenSeries ?? "").split(" ").filter(Boolean));
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      root.dataset.hiddenSeries = [...hidden].join(" ");
      button.setAttribute("aria-pressed", String(!hidden.has(key)));
      root.querySelectorAll<HTMLElement | SVGElement>(`[data-series="${CSS.escape(key)}"]`).forEach((n) => {
        if (n !== button) n.classList.toggle("is-series-hidden", hidden.has(key));
      });
      if (current && root.contains(current)) render(current);
    }

    // ---- teclado ----
    function hitsOf(group: HTMLElement) {
      return [...group.querySelectorAll<HTMLElement>(".chart-hit")];
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target as HTMLElement;
      if (target.classList?.contains("chart-hits")) {
        const hits = hitsOf(target);
        const start = hits.find((h) => h === current) ?? hits.at(-1);
        if (start) show(start);
      } else if (target.dataset?.tip != null) {
        show(target);
      }
    }

    function onFocusOut(event: FocusEvent) {
      const next = event.relatedTarget as Node | null;
      const from = event.target as HTMLElement;
      if (!next || !from.contains(next)) hide();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        hide();
        return;
      }
      const group = (event.target as HTMLElement).closest<HTMLElement>(".chart-hits");
      if (!group || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const hits = hitsOf(group);
      if (!hits.length) return;
      const index = current ? hits.indexOf(current) : -1;
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? hits.length - 1
        : event.key === "ArrowLeft" ? Math.max(0, (index < 0 ? hits.length : index) - 1)
        : Math.min(hits.length - 1, index + 1);
      show(hits[next]);
    }

    const onScroll = () => hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onLeaveWindow);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onLeaveWindow);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
      tip.remove();
    };
  }, []);

  return null;
}
