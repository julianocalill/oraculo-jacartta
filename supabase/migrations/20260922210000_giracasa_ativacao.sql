-- Giracasa: ativação da operação.
--
-- Liga enabled=true e libera a operação para os usuários atuais. O conjunto de
-- abas é menor que o de Uberlândia de propósito: Importações, Logística,
-- Mercado Livre, Agenda, RPA, Full, Expedição, Reconciliação, Inteligência,
-- Devoluções, Shopee e Análise Comercial não têm dado na Giracasa hoje, e
-- abririam telas vazias. Elas entram conforme as fontes forem ligadas.
--
-- Estado que sustenta a ativação (22/09/2026):
--   * motor gira-casa-v2 (ADR-009), margem 7,37% na janela conferida;
--   * pedidos e notas em dia (12.663 notas e 14.243 pedidos de 08 a 22/09);
--   * 11 crons giracasa-* ativos, incluindo derivados, estoque e caches;
--   * cobertura de item 98,4% e de custo 85,5% nos últimos 14 dias.
--
-- Pendências conhecidas, registradas em docs/project-status-2026-09-17-giracasa.md:
-- apuração de agosto do escritório, 471 NFs de pedidos cancelados, tarifas de
-- TikTok e Mercado Livre (19% da receita sem lucro calculável) e cadastro dos
-- SKUs sem custo.
--
-- Reversão: update public.oraculo_operations set enabled = false where id = 'giracasa';

update public.oraculo_operations
set enabled = true,
    activated_at = coalesce(activated_at, now())
where id = 'giracasa';

-- Libera a Giracasa para quem já usa o Oráculo, com as abas que têm dado.
update auth.users u
set raw_app_meta_data = jsonb_set(
      coalesce(u.raw_app_meta_data, '{}'::jsonb),
      '{operations,giracasa}',
      jsonb_build_object(
        'enabled', true,
        'tabs', jsonb_build_array(
          'analytics',
          'pedidos',
          'mais-vendidos',
          'skus',
          'curva-de-venda',
          'curva-de-estoque',
          'previsao-de-vendas',
          'calculadora',
          'documentacao'
        ),
        'restricted_tabs', coalesce(u.raw_app_meta_data->'operations'->'uberlandia'->'restricted_tabs', '[]'::jsonb),
        'full_manager', false
      ),
      true
    )
where coalesce(u.raw_app_meta_data->'operations'->'uberlandia'->>'enabled', 'false') = 'true'
  and (u.banned_until is null or u.banned_until <= now());
