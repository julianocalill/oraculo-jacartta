"use client";

import { useMemo, useState } from "react";
import { createFull, reviseFull } from "./actions";
import type { CommercialCatalogItem, FullChannel, FullStoreConfig, PhysicalProductOption } from "./data";

type UserOption = { id: string; name: string; email: string };
type BuilderRow = { id: string; commercialKey: string; physicalProductId: string; quantity: number };

export function FullBuilder({
  stores,
  commercialItems,
  physicalProducts,
  users,
  initial
}: {
  stores: FullStoreConfig[];
  commercialItems: CommercialCatalogItem[];
  physicalProducts: PhysicalProductOption[];
  users: UserOption[];
  initial?: {
    fullId: string;
    channel: FullChannel;
    storeKey: string;
    logisticsUserId: string;
    rows: Array<{ commercialKey: string; physicalProductId: string; quantity: number }>;
  };
}) {
  const firstStore = initial
    ? stores.find((store) => store.channel === initial.channel && store.store_key === initial.storeKey)
    : stores[0];
  const [channel, setChannel] = useState<FullChannel>(initial?.channel ?? firstStore?.channel ?? "mercadolivre");
  const storesForChannel = useMemo(() => stores.filter((store) => store.channel === channel), [stores, channel]);
  const [storeKey, setStoreKey] = useState(initial?.storeKey ?? firstStore?.store_key ?? "");
  const selectedStore = stores.find((store) => store.channel === channel && store.store_key === storeKey) ?? storesForChannel[0];
  const [logisticsUserId, setLogisticsUserId] = useState(initial?.logisticsUserId ?? selectedStore?.default_logistics_user_id ?? "");
  const [rows, setRows] = useState<BuilderRow[]>(
    (initial?.rows.length ? initial.rows : [{ commercialKey: "", physicalProductId: "", quantity: 1 }])
      .map((row, index) => ({ ...row, id: `${index}-${row.commercialKey}` }))
  );

  const availableItems = useMemo(
    () => commercialItems.filter((item) => item.channel === channel && item.storeKey === (selectedStore?.store_key ?? storeKey)),
    [commercialItems, channel, selectedStore?.store_key, storeKey]
  );
  const itemByKey = useMemo(() => new Map(availableItems.map((item) => [item.key, item])), [availableItems]);
  const productById = useMemo(() => new Map(physicalProducts.map((product) => [product.id, product])), [physicalProducts]);
  const containsKit = rows.some((row) => productById.get(row.physicalProductId)?.type === "K");
  const serializedRows = JSON.stringify(rows.map(({ commercialKey, physicalProductId, quantity }) => ({ commercialKey, physicalProductId, quantity })));

  function changeChannel(next: FullChannel) {
    const store = stores.find((entry) => entry.channel === next);
    setChannel(next);
    setStoreKey(store?.store_key ?? "");
    setLogisticsUserId(store?.default_logistics_user_id ?? "");
    setRows([{ id: crypto.randomUUID(), commercialKey: "", physicalProductId: "", quantity: 1 }]);
  }

  function changeStore(next: string) {
    const store = stores.find((entry) => entry.channel === channel && entry.store_key === next);
    setStoreKey(next);
    setLogisticsUserId(store?.default_logistics_user_id ?? "");
    setRows([{ id: crypto.randomUUID(), commercialKey: "", physicalProductId: "", quantity: 1 }]);
  }

  function patchRow(id: string, patch: Partial<BuilderRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function chooseCommercial(id: string, key: string) {
    const item = itemByKey.get(key);
    patchRow(id, {
      commercialKey: key,
      physicalProductId: item?.suggestedOlistProductId ?? ""
    });
  }

  const action = initial ? reviseFull : createFull;
  return (
    <form action={action} className="full-builder panel">
      {initial ? <input type="hidden" name="full_id" value={initial.fullId} /> : null}
      <input type="hidden" name="items_json" value={serializedRows} />

      <div className="full-form-grid">
        <label>
          <span>Marketplace</span>
          <select name="channel" value={channel} disabled={Boolean(initial)} onChange={(event) => changeChannel(event.target.value as FullChannel)}>
            <option value="mercadolivre">Mercado Livre Full</option>
            <option value="shopee">Shopee FBS</option>
            <option value="amazon">Amazon Onsite</option>
          </select>
        </label>
        <label>
          <span>Loja</span>
          <select name="store_key" value={selectedStore?.store_key ?? ""} disabled={Boolean(initial)} onChange={(event) => changeStore(event.target.value)} required>
            {storesForChannel.map((store) => <option key={store.id} value={store.store_key}>{store.store_name}</option>)}
          </select>
        </label>
        <label>
          <span>Responsável pela logística</span>
          <select name="logistics_user_id" value={logisticsUserId} onChange={(event) => setLogisticsUserId(event.target.value)} required>
            <option value="">Selecione</option>
            {users.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
          </select>
        </label>
      </div>

      {initial ? (
        <label className="full-reason">
          <span>Motivo da nova revisão</span>
          <textarea name="reason" rows={2} required placeholder="Explique o que mudou e por quê." />
        </label>
      ) : null}

      {selectedStore && !selectedStore.submission_enabled ? (
        <div className="status-alert status-alert-warning">
          Rascunhos estão disponíveis, mas o envio à logística permanece bloqueado até validar coleta e recebimento automáticos. {selectedStore.validation_note}
        </div>
      ) : null}

      <div className="section-head full-items-head">
        <div><p className="eyebrow">Composição</p><h2>Itens da remessa</h2></div>
        <button type="button" className="button-secondary" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), commercialKey: "", physicalProductId: "", quantity: 1 }])}>Adicionar item</button>
      </div>

      <div className="full-builder-items">
        {rows.map((row, index) => {
          const commercial = itemByKey.get(row.commercialKey);
          return (
            <div className="full-builder-row" key={row.id}>
              <strong>{index + 1}</strong>
              <label>
                <span>Anúncio / variação</span>
                <select value={row.commercialKey} onChange={(event) => chooseCommercial(row.id, event.target.value)} required>
                  <option value="">Selecione o item</option>
                  {availableItems.map((item) => (
                    <option key={item.key} value={item.key}>{item.sku ? `${item.sku} · ` : ""}{item.title}{item.variation ? ` · ${item.variation}` : ""}</option>
                  ))}
                </select>
                {commercial ? <small>{commercial.mappingStatus ? `De-para: ${commercial.mappingStatus}` : "Sem sugestão automática; confirme o produto Olist."}</small> : null}
              </label>
              <label>
                <span>Produto físico Olist</span>
                <select value={row.physicalProductId} onChange={(event) => patchRow(row.id, { physicalProductId: event.target.value })} required>
                  <option value="">Selecione e confirme</option>
                  {physicalProducts.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.title}{product.type === "K" ? " · KIT" : ""}</option>)}
                </select>
              </label>
              <label>
                <span>Quantidade</span>
                <input type="number" min={1} max={1000000} step={1} value={row.quantity} onChange={(event) => patchRow(row.id, { quantity: Number(event.target.value) })} required />
              </label>
              <button type="button" className="button-danger button-compact" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}>Remover</button>
            </div>
          );
        })}
      </div>

      {containsKit ? (
        <label className="full-kit-confirm">
          <input type="checkbox" name="confirm_kits" value="yes" required />
          <span>Confirmei os kits e autorizo a expansão automática nos componentes físicos do Olist.</span>
        </label>
      ) : null}

      <div className="form-actions">
        <button type="submit">{initial ? "Criar nova revisão" : "Criar rascunho"}</button>
      </div>
    </form>
  );
}
