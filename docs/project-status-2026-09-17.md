# Estado do projeto — 17/09/2026

## Setor de RH no Oráculo

O novo setor **Pessoas → RH** foi publicado em produção com cinco visões:
Visão geral, Recrutamento, Pessoas, Desenvolvimento e Governança. A primeira
versão incorpora o diagnóstico consolidado de RH, diferencia indicadores
medidos de lacunas e apresenta o fluxo futuro de recrutamento com IA, n8n,
WhatsApp oficial, Chatwoot, CRM do Oráculo, Supabase e Google Agenda.

A visão Pessoas inclui o desenho do diretório e do prontuário funcional 360º.
Os seis perfis desta versão são explicitamente fictícios; nenhum cadastro real
de colaborador foi importado. Dados pessoais, saúde, remuneração e documentos
continuam condicionados à modelagem de RLS, auditoria e retenção antes de uma
integração produtiva.

- Commit: `821ad0c`.
- Deployment: `dpl_HB5NWFpPTt38G9s2AgQz7rFzrAyn`, estado `READY`.
- Produção: `https://oraculo.oliverhome.com.br/o/uberlandia/rh`.
- Validações: 85 testes de domínio, TypeScript e build Next.js aprovados.

## Separação operacional com mínimo de uma caixa

O fechamento de `Logística → Separação` agora inclui todo SKU que formar ao
menos **uma caixa completa**. O limite anterior de duas caixas foi alterado no
Postgres e no workflow multicanal do n8n, mantendo a ordenação por quantidade
de caixas e unidades avulsas.

A migration
`20260917104707_logistica_separacao_minimo_uma_caixa.sql` está aplicada em
produção. O workflow ativo é
`Olist ERP - Separação Todos Marketplaces WhatsApp 07h e 13h30`
(`UGLCLNS6oVCK87o3`). A cópia de interface e a nota de versão estão prontas no
repositório para publicação pelo fluxo normal do Vercel.

## Recuperação do fechamento de hoje

O fechamento de 17/09 não avançou porque dois pedidos candidatos tinham sido
vistos pela primeira vez em 16/09, mas ainda estavam sem itens hidratados. Eles
tinham data de criação mais antiga do que a janela da sincronização manual. Os
dois pedidos foram hidratados diretamente pela API do Olist. A primeira
recuperação foi silenciosa; após cadastrar a regra dos tapetes, o mesmo
fechamento foi reprocessado e enviado pelo WhatsApp.

Resultado persistido:

- lista `e043970a-b9c2-4870-af90-f27729dedb75`, status `ready`;
- 2.009 pedidos e nenhum pedido candidato sem itens;
- 26 linhas, 130 caixas completas e 85 unidades avulsas;
- WhatsApp `sent` às 08:31 BRT.

## Tapetes

Após confirmação operacional, tapetes higiênicos usam **seis pacotes físicos
por caixa**. Produtos simples contam um pacote por unidade vendida. Kits usam a
composição do cadastro Olist para converter cada venda na quantidade real de
pacotes antes de fechar as caixas.

A regra não alcança tapete musical ou tapete de banheiro. O fechamento da manhã
foi reprocessado com 13 SKUs de tapete, totalizando 26 linhas e 130 caixas no
documento completo. O WhatsApp foi enviado com sucesso às 08:31 BRT.

## Validações

- Prévia real final: 26 linhas; 13 SKUs de tapete incluídos.
- Kit 50×60 de 100 unidades: 47 vendas = 94 pacotes = 15 caixas + 4 pacotes.
- Tapete 50×60 de 50 unidades: 90 vendas = 15 caixas exatas.
- Teste transacional da função: uma e duas caixas entram; zero caixa fica fora.
- 12 testes do workflow de integração aprovados.
- 85 testes de domínio do Oráculo aprovados.
- TypeScript aprovado.
- Advisors do Supabase sem achado novo nos objetos `logistica_picking`.

Contrato e operação: [Separação operacional](logistica-separacao.md).
