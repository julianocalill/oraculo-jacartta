import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateShopeeLiveOrders,
  saoPauloDateHour
} from "../../supabase/functions/_shared/shopee-live-monitor.js";

const sec = (iso) => Math.floor(new Date(iso).getTime() / 1000);

test("converte o timestamp da Shopee para data e hora de São Paulo", () => {
  assert.deepEqual(saoPauloDateHour(sec("2026-09-17T10:30:00Z")), {
    date: "2026-09-17",
    hour: 7
  });
});

test("consolida receita, pedidos, unidades, compradores e hora sem contar cancelados", () => {
  const result = aggregateShopeeLiveOrders(
    [
      {
        order_sn: "A",
        order_status: "READY_TO_SHIP",
        create_time: sec("2026-09-17T10:10:00Z"),
        total_amount: 120.5,
        buyer_user_id: 10,
        item_list: [
          { item_id: 1, model_id: 2, item_name: "Pote", model_name: "Azul", model_sku: "P-1", model_quantity_purchased: 2, model_discounted_price: 50 },
          { item_id: 3, item_name: "Tampa", item_sku: "T-1", model_quantity_purchased: 1, model_discounted_price: 20.5 }
        ]
      },
      {
        order_sn: "B",
        order_status: "SHIPPED",
        create_time: sec("2026-09-17T10:45:00Z"),
        total_amount: 50,
        buyer_user_id: 10,
        item_list: [
          { item_id: 1, model_id: 2, item_name: "Pote", model_name: "Azul", model_sku: "P-1", model_quantity_purchased: 1, model_discounted_price: 50 }
        ]
      },
      {
        order_sn: "C",
        order_status: "CANCELLED",
        create_time: sec("2026-09-17T11:00:00Z"),
        total_amount: 999,
        buyer_user_id: 20,
        item_list: [{ item_id: 9, item_name: "Ignorado", model_quantity_purchased: 9 }]
      }
    ],
    { today: "2026-09-17", previous: "2026-09-16" }
  );

  assert.deepEqual(result.current, { gross: 170.5, orders: 2, units: 4, buyers: 1 });
  assert.equal(result.hourly[7].today, 170.5);
  assert.equal(result.products[0].sku, "P-1");
  assert.equal(result.products[0].gmv, 150);
  assert.equal(result.products[0].units, 3);
  assert.equal(result.products[0].orders, 2);
  assert.equal(result.accepted_orders, 2);
});

test("separa hoje de ontem e usa usuário como fallback de comprador", () => {
  const result = aggregateShopeeLiveOrders(
    [
      {
        order_sn: "Y",
        order_status: "COMPLETED",
        create_time: sec("2026-09-17T01:30:00Z"),
        total_amount: "90.25",
        buyer_username: "Cliente",
        item_list: [{ item_id: 1, item_name: "Produto", model_quantity_purchased: 2 }]
      }
    ],
    { today: "2026-09-17", previous: "2026-09-16" }
  );

  assert.deepEqual(result.current, { gross: 0, orders: 0, units: 0, buyers: 0 });
  assert.deepEqual(result.previous, { gross: 90.25, orders: 1, units: 2, buyers: 1 });
  assert.equal(result.hourly[22].previous, 90.25);
  assert.equal(result.products.length, 0);
});
