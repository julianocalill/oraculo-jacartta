"use client";

import { useId, useState } from "react";
import { TABS, type TabKey } from "../../lib/auth/tabs";

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

  const main = TABS.filter((tab) => tab.group === "main");
  const admin = TABS.filter((tab) => tab.group === "admin");

  return (
    <div className="tab-access">
      <div className="tab-access-head">
        <span>Abas liberadas</span>
        <div className="tab-access-actions">
          <button type="button" onClick={() => setChecked(new Set(TABS.map((tab) => tab.key)))}>
            Marcar todas
          </button>
          <button type="button" onClick={() => setChecked(new Set())}>
            Limpar
          </button>
        </div>
      </div>

      {[
        { label: "Principal", items: main },
        { label: "Admin", items: admin }
      ].map((group) => (
        <div className="tab-access-group" key={group.label}>
          <small>{group.label}</small>
          <div className="tab-grid">
            {group.items.map((tab) => (
              <label className="tab-check" key={tab.key} htmlFor={`${groupId}-${tab.key}`}>
                <input
                  id={`${groupId}-${tab.key}`}
                  type="checkbox"
                  name="tabs"
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
