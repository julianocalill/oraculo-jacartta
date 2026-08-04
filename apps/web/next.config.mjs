/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Upload da planilha de devoluções (/devolucoes). O arquivo de julho tem
    // 278 KB, mas o teto padrão de server action é 1 MB e a exportação cresce
    // a cada mês acumulado — 10 MB dá folga sem virar porta aberta.
    serverActions: { bodySizeLimit: "10mb" }
  }
};

export default nextConfig;
