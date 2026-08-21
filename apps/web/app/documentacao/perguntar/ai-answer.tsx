import Link from "next/link";
import { askOllama } from "../ollama";
import type { Candidates } from "../ask";
import type { CatalogObject } from "../data";

// Server component assíncrono, renderizado dentro de um <Suspense> — a página
// aparece na hora e este bloco chega quando o Ollama responder. Sem client JS.
export async function AiAnswer({
  candidates,
  objects
}: {
  candidates: Candidates;
  objects: CatalogObject[];
}) {
  const answer = await askOllama(candidates, objects);

  if (!answer) {
    return (
      <p className="fiscal-note">
        A leitura por IA não está disponível agora — o que aparece acima veio da busca no catálogo, que não depende
        dela.
      </p>
    );
  }

  return (
    <div className="doc-prose">
      <p>{answer.resposta}</p>

      {answer.objetos.length > 0 ? (
        <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {answer.objetos.map((objeto) => (
            <Link key={objeto} href={`/documentacao/dicionario/${objeto}`} className="pill">
              {objeto}
            </Link>
          ))}
        </div>
      ) : null}

      {answer.inventados.length > 0 ? (
        <p className="fiscal-note" style={{ marginTop: 12 }}>
          A IA citou {answer.inventados.length === 1 ? "um nome que não existe" : "nomes que não existem"} no banco (
          {answer.inventados.join(", ")}). Foram descartados — confie na lista de objetos acima, que vem do catálogo.
        </p>
      ) : null}

      <p className="fiscal-note" style={{ marginTop: 12 }}>
        Escrito por IA local a partir dos resultados da busca. Serve para achar o caminho — confira a descrição do
        objeto antes de publicar qualquer número.
      </p>
    </div>
  );
}
