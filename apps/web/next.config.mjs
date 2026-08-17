/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Upload da planilha de devoluções (/devolucoes). O arquivo de julho tem
    // 278 KB, mas o teto padrão de server action é 1 MB e a exportação cresce
    // a cada mês acumulado — 10 MB dá folga sem virar porta aberta.
    serverActions: { bodySizeLimit: "10mb" }
  },
  // @oraculo/domain é JS puro publicado direto do workspace, sem etapa de
  // build. Sem isto o Next não o atravessa e o import quebra no server bundle.
  transpilePackages: ["@oraculo/domain"]
};

export default nextConfig;
