import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("funções geradas da Giracasa não reutilizam secrets de Uberlândia", async () => {
  const output = await mkdtemp(join(tmpdir(), "oraculo-giracasa-functions-"));
  try {
    const generated = spawnSync(process.execPath, [
      "scripts/build-operation-functions.mjs",
      "--operation=giracasa",
      `--out=${output}`
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const manifest = JSON.parse(await readFile(join(output, "MANIFEST.json"), "utf8"));
    const directories = (await readdir(output, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory());
    assert.equal(directories.length, manifest.sourceFunctions.length);
    assert.equal(manifest.schema, "giracasa");

    const allowedShared = new Set(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    for (const directory of directories) {
      const code = await readFile(join(output, directory.name, "index.ts"), "utf8");
      assert.match(directory.name, /^giracasa-/);
      for (const match of code.matchAll(/Deno\.env\.get\(["']([A-Z][A-Z0-9_]*)["']\)/g)) {
        assert.ok(
          allowedShared.has(match[1]) || match[1].startsWith("GIRACASA_"),
          `${directory.name} ainda lê ${match[1]}`
        );
      }
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
