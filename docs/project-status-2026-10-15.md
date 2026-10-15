# Estado público da camada fiscal

A tabela de impostos por pedido usa funções compartilhadas, XML de NF autorizado,
custo bruto do cadastro vigente e tarifas reais dos marketplaces suportados.
As entradas financeiras incompletas preservam margem pendente. A conciliação
Shopee exige extrato liquidado, receita da NF compatível e componentes tratados.
O Mercado Livre de cada operação usa conta e schema próprios; o callback verifica
PKCE, estado OAuth e seller esperado antes de salvar os tokens.

Os relatórios de coleta, referências de pedidos, valores de custo/margem e
vínculos específicos de produtos são evidência privada. Eles não fazem parte
do histórico público. O código público mantém somente testes sintéticos.
As migrations públicas contêm DDL e permissões; configuração comercial é privada.

Validação da revisão sanitizada: 152 testes passaram. A limpeza de histórico
foi preparada localmente e aguarda autorização para substituir o remote público.
Continuidade: [publicação segura](public-publishing.md).
