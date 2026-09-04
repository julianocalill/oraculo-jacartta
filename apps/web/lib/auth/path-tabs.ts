import { TABS, type TabKey } from "./tabs";
import { parseOperationPath } from "@oraculo/domain/operations.js";
// Resolve a aba dona de um caminho (sub-rotas e exports herdam a aba-mãe).
export function tabForPath(pathname: string): TabKey | null {
  pathname = parseOperationPath(pathname).path;
  let match: { key: TabKey; length: number } | null = null;

  for (const tab of TABS) {
    for (const path of tab.paths) {
      const hit = path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
      if (!hit) continue;
      if (!match || path.length > match.length) {
        match = { key: tab.key, length: path.length };
      }
    }
  }

  return match?.key ?? null;
}

