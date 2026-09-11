#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const operation = process.argv.find((arg) => arg.startsWith("--operation="))?.split("=")[1];
const output = resolve(process.argv.find((arg) => arg.startsWith("--out="))?.split("=")[1] ?? `/tmp/oraculo-${operation}-functions`);
if (operation !== "giracasa") throw new Error("O builder isolado está liberado somente para --operation=giracasa.");
const source = resolve("supabase/functions");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const functionNames = (await import("node:fs/promises")).readdir(source, { withFileTypes: true })
  .then((items) => items
    .filter((item) => item.isDirectory() && !item.name.startsWith("giracasa-"))
    .map((item) => item.name));
const names = await functionNames;
const sharedEnv = new Set(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

for (const name of names) {
  const entry = join(source, name, "index.ts");
  let code;
  try { code = await readFile(entry, "utf8"); } catch { continue; }
  // Same Supabase project, isolated PostgREST schema. Credentials are prefixed
  // without a fallback, so missing Giracasa secrets can never use MG accounts.
  code = code.replaceAll('import { createClient } from ', 'import { createClient as baseCreateClient } from ');
  if (!code.includes("baseCreateClient")) continue;
  code = code.replace(/Deno\.env\.get\((["'])([A-Z][A-Z0-9_]*)\1\)/g, (_all, quote, key) =>
    `Deno.env.get(${quote}${sharedEnv.has(key) ? key : `GIRACASA_${key}`}${quote})`);
  if (name === "shopee-price-product-refresh") code = code.replace('const profit = costTotal !== null && typeof price === "number" ? lucro(price, costTotal) : null;', 'const profit = null; // margem depende de NF/UF e fica pendente até a camada fiscal');
  for (const target of names) code = code.replaceAll(`/functions/v1/${target}`, `/functions/v1/giracasa-${target}`);
  const insertAt = [...code.matchAll(/^import .*;\s*$/gm)].at(-1)?.index;
  if (insertAt == null) throw new Error(`Imports não reconhecidos em ${name}`);
  const lineEnd = code.indexOf("\n", insertAt) + 1;
  const factory = `\nconst createClient = ((url: string, key: string, options: Record<string, unknown> = {}) =>\n  baseCreateClient(url, key, { ...options, db: { ...((options.db as object | undefined) ?? {}), schema: \"giracasa\" } })) as typeof baseCreateClient;\n`;
  code = code.slice(0, lineEnd) + factory + code.slice(lineEnd);
  const targetDir = join(output, `giracasa-${name}`);
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "index.ts"), code);
}
for (const filename of ["README.md"]) {
  try { await cp(join(source, filename), join(output, basename(filename))); } catch { /* optional */ }
}
await writeFile(join(output, "MANIFEST.json"), JSON.stringify({ operation, schema: "giracasa",
  generatedAt: new Date().toISOString(), sourceFunctions: names }, null, 2));
console.log(`Generated ${names.length} isolated Giracasa functions in ${output}`);
