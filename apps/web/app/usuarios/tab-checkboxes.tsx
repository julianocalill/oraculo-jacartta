"use client";

import { useId, useState } from "react";
import { SECTORS, TABS, type TabKey } from "../../lib/auth/tabs";

// Matriz de acesso de um usuário: uma caixinha por aba do menu.
// Client component só por causa dos atalhos "marcar todas"/"limpar" — com 15
// caixas por usuário, marcar uma a uma é inviável no dia a dia.
export function TabCheckboxes({ selected = [] }: { selected?: TabKey[] }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));
  const groupId = useId();

  function toggle(key: TabKey, value: boolean) {
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // Mesma organização do menu lateral: setores, depois as abas soltas, depois
  // Admin. Abas restritas ficam em um grupo próprio e não entram no atalho
  // "Marcar todas": precisam sempre de uma concessão deliberada.
  const grantable = TABS.filter((tab) => !("adminOnly" in tab && tab.adminOnly));
  const restricted = TABS.filter((tab) => "adminOnly" in tab && tab.adminOnly);
  const groups = [
    ...SECTORS.map((sector) => ({
      label: sector.label,
      items: grantable.filter((tab) => tab.group === "main" && "sector" in tab && tab.sector === sector.key)
    })),
    { label: "Geral", items: grantable.filter((tab) => tab.group === "main" && !("sector" in tab)) },
    { label: "Admin", items: grantable.filter((tab) => tab.group === "admin") },
    { label: "Restrito", items: restricted }
  ];

  return (
    <div className="tab-access">
      <div className="tab-access-head">
        <span>Abas liberadas</span>
        <div className="tab-access-actions">
          <button
            type="button"
            onClick={() =>
              setChecked((current) =>
                new Set([
                  ...grantable.map((tab) => tab.key),
                  ...restricted.filter((tab) => current.has(tab.key)).map((tab) => tab.key)
                ])
              )
            }
          >
            Marcar todas
          </button>
          <button type="button" onClick={() => setChecked(new Set())}>
            Limpar
          </button>
        </div>
      </div>

      {groups.map((group) => (
        <div className="tab-access-group" key={group.label}>
          <small>{group.label}</small>
          <div className="tab-grid">
            {group.items.map((tab) => (
              <label className="tab-check" key={tab.key} htmlFor={`${groupId}-${tab.key}`}>
                <input
                  id={`${groupId}-${tab.key}`}
                  type="checkbox"
                  name={"adminOnly" in tab && tab.adminOnly ? "restricted_tabs" : "tabs"}
                  value={tab.key}
                  checked={checked.has(tab.key)}
                  onChange={(event) => toggle(tab.key, event.target.checked)}
                />
                <span>{tab.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
