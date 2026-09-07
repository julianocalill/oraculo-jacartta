import Link from "next/link";
import { revalidatePath } from "next/cache";
import { assertTabAccess, requireTabAccess } from "../../../../lib/auth/access";
import { getCurrentUser } from "../../../../lib/auth/session";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { NoAccess } from "../../../components/no-access";
import { AppShell } from "../../../components/app-shell";
import { loadActionableAlertCount } from "../../../../lib/alert-count";
import { loadRecebimento, loadSkuOptions, sugerirDivergencia, type RecebimentoItem } from "../data";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

function count(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value));
}

function numOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function divergenciaLabel(value: RecebimentoItem["divergencia"]) {
  if (value === "ok") return "OK";
  if (value === "falta") return "Falta";
  if (value === "sobra") return "Sobra";
  if (value === "avaria") return "Avaria";
  return "Não conferido";
}

function divergenciaBadge(value: RecebimentoItem["divergencia"]) {
  if (value === "ok") return "status-pill signal-good";
  if (value === "falta" || value === "avaria") return "status-pill signal-danger";
  if (value === "sobra") return "status-pill signal-warning";
  return "status-pill signal-muted";
}

/** Salva a conferência de um item (quantidade, cartons, divergência, SKU, observação). */
async function conferirItem(formData: FormData) {
  "use server";
  await assertTabAccess("logistica");
  const user = await getCurrentUser();

  const recebimentoId = String(formData.get("recebimento_id") ?? "").trim();
  const itemId = Number(formData.get("item_id"));
  if (!recebimentoId || !Number.isFinite(itemId)) throw new Error("Item inválido.");

  const qtyConferida = numOrNull(formData.get("qty_conferida"));
  const cartonsConferidos = numOrNull(formData.get("cartons_conferidos"));
  const qtyEsperada = numOrNull(formData.get("qty_esperada"));
  const divergenciaRaw = String(formData.get("divergencia") ?? "").trim();
  const divergencia = ["ok", "falta", "sobra", "avaria"].includes(divergenciaRaw)
    ? (divergenciaRaw as RecebimentoItem["divergencia"])
    : sugerirDivergencia(qtyEsperada, qtyConferida);
  const sku = String(formData.get("sku") ?? "").trim() || null;
  const observacao = String(formData.get("observacao") ?? "").trim() || null;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("logistica_recebimento_itens")
    .update({
      qty_conferida: qtyConferida,
      cartons_conferidos: cartonsConferidos,
      divergencia,
      sku,
      observacao,
      conferido_em: qtyConferida == null ? null : new Date().toISOString(),
      conferido_por: qtyConferida == null ? null : user?.email ?? null
    })
    .eq("id", itemId)
    .eq("recebimento_id", recebimentoId);
  if (error) throw error;

  revalidatePath(`/logistica/recebimento/${recebimentoId}`);
  revalidatePath("/logistica/recebimento");
}

/**
 * Conclui a conferência. Status vira concluido_com_divergencia quando algum
 * item ficou como falta/sobra/avaria; item não conferido conta como falta
 * total (a pessoa vê o aviso antes de concluir).
 */
async function concluirRecebimento(formData: FormData) {
  "use server";
  await assertTabAccess("logistica");
  const user = await getCurrentUser();

  const recebimentoId = String(formData.get("recebimento_id") ?? "").trim();
  if (!recebimentoId) throw new Error("Recebimento inválido.");
  const observacoes = String(formData.get("observacoes") ?? "").trim() || null;

  const supabase = createSupabaseAdminClient();
  const { data: itens } = await supabase
    .from("logistica_recebimento_itens")
    .select("id, divergencia, conferido_em")
    .eq("recebimento_id", recebimentoId);

  const rows = (itens ?? []) as Array<{ id: number; divergencia: string | null; conferido_em: string | null }>;
  const naoConferidos = rows.filter((row) => !row.conferido_em).map((row) => row.id);
  if (naoConferidos.length > 0) {
    const { error } = await supabase
      .from("logistica_recebimento_itens")
      .update({ qty_conferida: 0, divergencia: "falta", conferido_em: new Date().toISOString(), conferido_por: user?.email ?? null })
      .in("id", naoConferidos);
    if (error) throw error;
  }

  const temDivergencia = rows.some((row) => row.divergencia && row.divergencia !== "ok") || naoConferidos.length > 0;

  const { error } = await supabase
    .from("logistica_recebimentos")
    .update({
      status: temDivergencia ? "concluido_com_divergencia" : "concluido",
      observacoes,
      concluido_em: new Date().toISOString(),
      concluido_por: user?.email ?? null
    })
    .eq("id", recebimentoId);
  if (error) throw error;

  revalidatePath(`/logistica/recebimento/${recebimentoId}`);
  revalidatePath("/logistica/recebimento");
}

/** Reabre uma conferência concluída (erro de digitação, chegada parcial). */
async function reabrirRecebimento(formData: FormData) {
  "use server";
  await assertTabAccess("logistica");
  const recebimentoId = String(formData.get("recebimento_id") ?? "").trim();
  if (!recebimentoId) throw new Error("Recebimento inválido.");

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("logistica_recebimentos")
    .update({ status: "em_conferencia", concluido_em: null, concluido_por: null })
    .eq("id", recebimentoId);
  if (error) throw error;

  revalidatePath(`/logistica/recebimento/${recebimentoId}`);
  revalidatePath("/logistica/recebimento");
}

export default async function RecebimentoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ allowed }, alertCount, data, skuOptions] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount(),
    loadRecebimento(String(id ?? "").trim()),
    loadSkuOptions()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Conferência não encontrada</h1>
            <p>Nenhum recebimento com o id {id}</p>
          </div>
        </header>
        <section className="panel">
          <p><Link href="/logistica/recebimento">Voltar para Recebimento</Link></p>
        </section>
      </AppShell>
    );
  }

  const { recebimento, itens, saldoPorSku } = data;
  const aberto = recebimento.status === "em_conferencia" || recebimento.status === "aguardando";
  const pendentes = itens.filter((item) => !item.conferido_em).length;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Fatura {recebimento.invoice_number}</h1>
          <p>
            {recebimento.container_number ? `Contêiner ${recebimento.container_number} · ` : ""}
            {count(recebimento.itens_conferidos)}/{count(recebimento.total_itens)} itens conferidos
            {recebimento.itens_divergentes > 0 ? ` · ${count(recebimento.itens_divergentes)} com divergência` : ""}
          </p>
        </div>
        <Link className="button-link" href="/logistica/recebimento">Voltar</Link>
      </header>

      {!aberto ? (
        <section className="panel recebimento-concluido">
          <p>
            <span className={recebimento.status === "concluido" ? "status-pill signal-good" : "status-pill signal-warning"}>
              {recebimento.status === "concluido" ? "Concluída" : "Concluída com divergência"}
            </span>{" "}
            em {recebimento.concluido_em ? dateTimeFormatter.format(new Date(recebimento.concluido_em)) : "-"}
            {recebimento.concluido_por ? ` por ${recebimento.concluido_por}` : ""}.
          </p>
          <form action={reabrirRecebimento}>
            <input type="hidden" name="recebimento_id" value={recebimento.id} />
            <button type="submit" className="recebimento-button secondary">Reabrir conferência</button>
          </form>
        </section>
      ) : null}

      <datalist id="recebimento-skus">
        {skuOptions.map((option) => (
          <option key={option.sku} value={option.sku}>{option.nome ?? ""}</option>
        ))}
      </datalist>

      <section className="recebimento-itens">
        {itens.map((item, index) => {
          const sugestao = sugerirDivergencia(item.qty_esperada, item.qty_conferida);
          const saldo = item.sku ? saldoPorSku.get(item.sku) : undefined;
          return (
            <form key={item.id} action={conferirItem} className={`panel recebimento-item${item.conferido_em ? " conferido" : ""}`}>
              <input type="hidden" name="recebimento_id" value={recebimento.id} />
              <input type="hidden" name="item_id" value={item.id} />
              <input type="hidden" name="qty_esperada" value={item.qty_esperada ?? ""} />

              <div className="recebimento-item-head">
                <div>
                  <p className="eyebrow">Item {index + 1} de {itens.length}</p>
                  <h2>{item.descricao}</h2>
                </div>
                <span className={divergenciaBadge(item.divergencia)}>{divergenciaLabel(item.divergencia)}</span>
              </div>

              <div className="recebimento-esperado">
                <div>
                  <small>Esperado</small>
                  <strong>{count(item.qty_esperada)} un.</strong>
                </div>
                <div>
                  <small>Cartons</small>
                  <strong>{count(item.cartons_esperados)}</strong>
                </div>
                {item.sku ? (
                  <div>
                    <small>Saldo Olist hoje</small>
                    <strong>{saldo === undefined ? "SKU não encontrado" : count(saldo)}</strong>
                  </div>
                ) : null}
              </div>

              <div className="recebimento-campos">
                <label>
                  <span>Quantidade conferida</span>
                  <input type="number" inputMode="decimal" step="any" name="qty_conferida" defaultValue={item.qty_conferida ?? ""} disabled={!aberto} />
                </label>
                <label>
                  <span>Cartons conferidos</span>
                  <input type="number" inputMode="decimal" step="any" name="cartons_conferidos" defaultValue={item.cartons_conferidos ?? ""} disabled={!aberto} />
                </label>
                <label>
                  <span>Divergência {sugestao && !item.divergencia ? `(sugestão: ${divergenciaLabel(sugestao)})` : ""}</span>
                  <select name="divergencia" defaultValue={item.divergencia ?? ""} disabled={!aberto}>
                    <option value="">Automática (pela quantidade)</option>
                    <option value="ok">OK</option>
                    <option value="falta">Falta</option>
                    <option value="sobra">Sobra</option>
                    <option value="avaria">Avaria</option>
                  </select>
                </label>
                <label>
                  <span>SKU Olist (opcional)</span>
                  <input type="text" name="sku" list="recebimento-skus" defaultValue={item.sku ?? ""} placeholder="ex.: 213997" autoComplete="off" disabled={!aberto} />
                </label>
                <label className="wide">
                  <span>Observação</span>
                  <input type="text" name="observacao" defaultValue={item.observacao ?? ""} placeholder="caixa molhada, lote diferente…" disabled={!aberto} />
                </label>
              </div>

              <div className="recebimento-item-foot">
                <small>
                  {item.conferido_em
                    ? `Conferido em ${dateTimeFormatter.format(new Date(item.conferido_em))}${item.conferido_por ? ` por ${item.conferido_por}` : ""}`
                    : "Ainda não conferido"}
                </small>
                {aberto ? <button type="submit" className="recebimento-button">Salvar item</button> : null}
              </div>
            </form>
          );
        })}
      </section>

      {aberto ? (
        <section className="panel recebimento-concluir">
          <div className="section-head">
            <p className="eyebrow">Fechar</p>
            <h2>Concluir conferência</h2>
          </div>
          {pendentes > 0 ? (
            <p className="etiqueta-hint">
              {count(pendentes)} item(ns) ainda sem conferência — ao concluir, entram como <strong>falta total</strong>.
            </p>
          ) : (
            <p className="etiqueta-hint">Todos os itens conferidos.</p>
          )}
          <form action={concluirRecebimento} className="upload-form manual-form">
            <input type="hidden" name="recebimento_id" value={recebimento.id} />
            <label>
              <span>Observações gerais</span>
              <textarea name="observacoes" rows={2} placeholder="lacre, estado do contêiner, quem recebeu…" />
            </label>
            <button type="submit" className="recebimento-button">Concluir conferência</button>
          </form>
        </section>
      ) : null}
    </AppShell>
  );
}
