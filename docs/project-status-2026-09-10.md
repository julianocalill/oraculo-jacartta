# Status do projeto — 10/09/2026

## Correção TikTok na calculadora

O preset de `/calculadora` herdava 6% + R$ 4 até R$ 78,99 e zerava a tarifa fixa acima desse valor. Corrigido para a tabela oficial vigente desde 15/07/2026:

- Preço após desconto do vendedor abaixo de R$ 50: 10% + R$ 4 por item vendido.
- A partir de R$ 50: 6% + R$ 6 por item vendido.

Fonte consultada em 10/09/2026: https://seller-br.tiktok.com/university/essay?knowledge_id=24428156307201

O simulador considera uma venda do anúncio; a quantidade preenchida representa as unidades dentro do anúncio/kit. Programa de frete e afiliados continuam excluídos, com indicação na tela. Condições específicas continuam editáveis. A nota da tela inclui link oficial e a mudança está no manifesto de novidades pós-login.

Caso relatado: custo R$ 65, venda R$ 129,90 e demais taxas padrão → tarifa fixa R$ 6, lucro líquido R$ 26,83 e margem 20,65%.

O restante do estado de produção está descrito em [09/09/2026](project-status-2026-09-09.md). Sem alteração de banco, integrações ou motor fiscal.

## Validação e publicação

Publicado em 11/09/2026 pela Vercel CLI, deployment `dpl_6Fa86rP5b58T4RDiBCHjZ2LTD7gt`, status `READY`, domínio `https://oraculo.oliverhome.com.br`.

Validação: 3 testes específicos da calculadora, 76 testes de domínio, TypeScript e build de produção aprovados. A rota `/calculadora` consta no build publicado; `/login` respondeu HTTP 200. O teste específico inclui R$ 49,99/R$ 50, a antiga fronteira R$ 78,99/R$ 79, o exemplo do diretor, kit e busca de preço mínimo por margem. Lint isolado não foi executado porque o projeto não tem configuração ESLint; build validou os tipos.

A base exata de produção era `11915c90784b7d7d79591424a2d746d057856174`, posterior e divergente da `main` local (`6acc6ed`). Cópia de publicação: `/private/tmp/oraculo-calculadora-tiktok-prod-20260911`. Comparação integral de `apps/web` e `packages` confirmou somente duas mudanças: `calculator.tsx` e `release-notes.ts`. Alterações locais preexistentes de tabelas foram preservadas. Nenhum commit/push realizado.

Próximo deploy: reconciliar a base local com a revisão publicada antes de enviar o projeto completo; publicar a main local antiga diretamente reverteria funcionalidades. As alterações da calculadora e a documentação também estão no projeto real, pendentes de versionamento autorizado.
