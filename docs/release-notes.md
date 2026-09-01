# Novidades pós-login

O Oráculo apresenta, depois da autenticação, todas as publicações ainda dentro
da janela de 48 horas. O objetivo é comunicar mudanças úteis sem transformar
cada troca de página em uma interrupção.

## Regra de exibição

- O login bem-sucedido cria o cookie HTTP-only `oraculo_login_event` com um
  identificador aleatório e a mesma duração da sessão.
- O `AppShell` seleciona as publicações ativas e entrega o identificador ao
  componente do pop-up.
- Ao fechar, o navegador registra o conjunto `login + publicações` como lido.
  Assim, o aviso não reaparece durante aquele login, nem em outra aba.
- Se o usuário marcar **Não mostrar novamente esta atualização**, os IDs que
  estavam visíveis são guardados como silenciados. Eles não reaparecem em
  logins futuros; uma publicação com ID novo continua elegível e abre o aviso.
- Um novo login muda o identificador e torna o aviso elegível novamente.
- Uma publicação é ativa de `publishedAt` até exatamente 48 horas depois. Se
  houver mais de uma na janela, todas aparecem no mesmo pop-up, da mais recente
  para a mais antiga.

## Como publicar uma novidade

No mesmo commit da mudança visível ao usuário, acrescente um objeto ao array
`RELEASE_NOTES` em `apps/web/lib/release-notes.ts`:

```ts
{
  id: "2026-09-03-nome-curto",
  title: "Título claro para o usuário",
  summary: "Uma frase explicando o ganho principal.",
  publishedAt: "2026-09-03T14:30:00-03:00",
  changes: [
    {
      title: "O que mudou",
      description: "Como isso ajuda no trabalho diário.",
      href: "/rota-opcional",
      linkLabel: "Conhecer mudança"
    }
  ]
}
```

Use um `id` único e estável. `publishedAt` deve ser o horário previsto da
publicação em produção, com fuso explícito. Se o deploy for adiado, ajuste esse
horário antes do push para não consumir parte da janela de 48 horas em
localhost ou em revisão.

O texto deve explicar benefício e ação em linguagem de produto. Não exponha
segredos, dados pessoais, detalhes internos de segurança ou números ainda não
validados. Mudanças estritamente técnicas, sem efeito perceptível, não precisam
de aviso.

## Checklist de validação

1. Entre no sistema e confirme que o pop-up apresenta todas as publicações
   ativas, com textos e links corretos.
2. Feche o aviso, navegue e abra outra aba: ele deve permanecer fechado.
3. Faça logout e login: ele deve reaparecer enquanto a janela estiver ativa.
4. Marque **Não mostrar novamente**, feche e simule outro login: o aviso deve
   permanecer oculto. Acrescente temporariamente um ID novo e confirme que ele
   volta a aparecer.
5. Confira desktop e uma tela de 390 × 844 px, inclusive quando várias
   publicações estiverem ativas.
6. Rode TypeScript, testes de domínio e build de produção.

Arquivos centrais:

- `apps/web/lib/release-notes.ts` — conteúdo e cálculo das 48 horas;
- `apps/web/app/components/release-notes-popup.tsx` — comportamento do pop-up;
- `apps/web/lib/auth/session.ts` — identificador de cada login;
- `apps/web/app/components/app-shell.tsx` — integração em todas as páginas
  autenticadas.
