import { ollamaConfig } from "./ask";
import type { Candidates } from "./ask";
import type { CatalogObject } from "./data";

// Cliente do Ollama na VPS (ia.oliverhome.com.br).
//
// A chamada sai da Vercel (iad1) direto para a VPS, sem o n8n no meio. Como
// não há intermediário para segurar carga, as travas ficam aqui:
//
//  - TIMEOUT curto: a VPS é COMPARTILHADA e o histórico do relatório de Ads
//    registra modelos maiores derrubando Ollama e workers. Uma busca não pode
//    prender recurso lá indefinidamente.
//  - num_predict limitado: resposta curta é o que queremos e é o que protege a VPS.
//  - Degradação silenciosa: qualquer falha devolve null e a tela mostra só o
//    resultado determinístico. A busca nunca fica indisponível por causa da IA.
//  - NADA de SQL: o modelo escolhe entre candidatos que já existem. Ele não
//    escreve consulta e não vê o schema inteiro.

const TIMEOUT_MS = 25_000;
const MAX_TOKENS = 320;

export type AiAnswer = {
  resposta: string;
  objetos: string[];
  receita: string | null;
  /** Nomes que o modelo citou e que NÃO existem no catálogo. */
  inventados: string[];
};

function buildPrompt(candidates: Candidates) {
  const objetos = candidates.objects
    .map((o) => `- ${o.object_name} (${o.object_kind}): ${o.object_comment ?? "sem descrição"}`)
    .join("\n");
  const receitas = candidates.recipes
    .map((r) => `- ${r.slug}: ${r.title} — responde "${r.question}" usando ${r.objects.join(", ")}`)
    .join("\n");

  return `Você ajuda pessoas de negócio a achar onde o dado mora no banco do Oráculo.

PERGUNTA DO USUÁRIO:
${candidates.question}

OBJETOS CANDIDATOS (são os únicos que você pode citar):
${objetos || "(nenhum)"}

RECEITAS DE SQL PRONTAS (são as únicas que você pode citar):
${receitas || "(nenhuma)"}

REGRAS:
- Responda em português do Brasil, no máximo 4 frases.
- Explique qual objeto usar e por quê, em linguagem de negócio.
- NÃO escreva SQL. NÃO invente nome de tabela, view ou coluna.
- Só cite nomes que aparecem nas listas acima.
- Se as listas não respondem a pergunta, diga isso claramente.

Responda SOMENTE com JSON válido, neste formato:
{"resposta":"texto explicando onde achar o dado","objetos":["nome_do_objeto"],"receita":"slug-da-receita ou null"}`;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function askOllama(
  candidates: Candidates,
  allObjects: CatalogObject[]
): Promise<AiAnswer | null> {
  const cfg = ollamaConfig();
  if (!cfg.enabled || !cfg.url) return null;
  if (candidates.objects.length === 0 && candidates.recipes.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        prompt: buildPrompt(candidates),
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: MAX_TOKENS }
      })
    });

    if (!res.ok) {
      console.error("[documentacao] ollama HTTP", res.status);
      return null;
    }

    const payload = (await res.json()) as { response?: string };
    const parsed = extractJson(payload.response ?? "");
    if (!parsed) return null;

    const resposta = typeof parsed.resposta === "string" ? parsed.resposta.trim() : "";
    if (!resposta) return null;

    // Validação: todo objeto citado tem de existir no catálogo. É a trava que
    // impede uma tabela alucinada de chegar à tela como se fosse real.
    const existentes = new Set(allObjects.map((o) => o.object_name));
    const citados = Array.isArray(parsed.objetos) ? parsed.objetos.filter((o): o is string => typeof o === "string") : [];
    const objetos = citados.filter((o) => existentes.has(o));
    const inventados = citados.filter((o) => !existentes.has(o));

    const receitaCitada = typeof parsed.receita === "string" ? parsed.receita : null;
    const receita = candidates.recipes.some((r) => r.slug === receitaCitada) ? receitaCitada : null;

    return { resposta, objetos, receita, inventados };
  } catch (error) {
    // Timeout, VPS fora, DNS, TLS: a tela degrada para o resultado determinístico.
    const motivo = error instanceof Error ? error.name : "desconhecido";
    console.error("[documentacao] ollama indisponível:", motivo);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
