// Dados de conexão do Postgres para as ferramentas de BI.
//
// SEGURANÇA — regras que esta tela impõe e que não devem ser afrouxadas:
//
// 1. Nenhum valor aqui vem de process.env. A senha do banco NÃO deve existir
//    como variável de ambiente do web app: se alguém adicionar, ela vira alvo.
// 2. A senha nunca é exibida, nem atrás do login. A tela ensina o processo de
//    obtê-la; o valor vive no gerenciador de senhas do time e no painel do
//    Supabase (Settings > Database).
// 3. O project ref não é credencial — é o subdomínio público da API e sem ele
//    ninguém conecta. Exibi-lo evita que a pessoa copie de uma mensagem de
//    chat, que é pior.

export const CONNECTION = {
  host: "aws-1-sa-east-1.pooler.supabase.com",
  port: "5432",
  database: "postgres",
  schema: "public",
  user: "postgres.bbtiipnmdxfxnxbemgjr",
  ssl: "require",
  region: "sa-east-1 (São Paulo)"
} as const;

export const CONNECTION_FIELDS: { label: string; value: string; note?: string }[] = [
  { label: "Host", value: CONNECTION.host },
  { label: "Porta", value: CONNECTION.port, note: "session mode — não use 6543" },
  { label: "Banco", value: CONNECTION.database },
  { label: "Schema", value: CONNECTION.schema },
  { label: "Usuário", value: CONNECTION.user },
  { label: "SSL", value: `sslmode=${CONNECTION.ssl}`, note: "obrigatório" },
  { label: "Região", value: CONNECTION.region }
];
