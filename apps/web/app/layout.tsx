import { OperationProvider } from "./components/operation-provider";
import { TableColumnHints } from "./components/table-column-hints";
import { getRequestOperation } from "../lib/operation-context";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { readSidebarState, readTheme } from "../lib/theme-server";

// Visual iOS/iPadOS 27: a fonte é a do sistema Apple (SF Pro via
// -apple-system, ver --sans no globals.css). Não embutimos SF Pro — a licença
// só permite usá-la em plataformas Apple. Fora delas (Windows/Android) cai no
// Inter, o parente mais próximo; next/font serve do próprio domínio.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans"
});

export const viewport: Viewport = {
  themeColor: "#000000"
};

export const metadata: Metadata = {
  title: {
    default: "Oráculo · Grupo Jacartta",
    template: "%s · Oráculo"
  },
  description:
    "Oráculo — plataforma de inteligência de vendas do Grupo Jacartta. Receita fiscal, margem, ROI e estoque multicanal em tempo real.",
  applicationName: "Oráculo",
  openGraph: {
    title: "Oráculo · Grupo Jacartta",
    description:
      "Inteligência de vendas do Grupo Jacartta: receita fiscal, margem, ROI e estoque multicanal.",
    siteName: "Oráculo",
    locale: "pt_BR",
    type: "website",
    images: [{ url: "/brand/oraculo-og.png", width: 1200, height: 630, alt: "Oráculo" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Oráculo · Grupo Jacartta",
    images: ["/brand/oraculo-og.png"]
  }
};

export default async function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const [theme, sidebar] = await Promise.all([readTheme(), readSidebarState()]);
  return (
    <html lang="pt-BR" data-theme={theme} data-sidebar={sidebar} className={inter.variable}>
      <body>
        <OperationProvider operation={await getRequestOperation()}>
          <TableColumnHints />
          {children}
        </OperationProvider>
      </body>
    </html>
  );
}
