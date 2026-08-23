import "./globals.css";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { readTheme } from "../lib/theme-server";

// Pareamento "Financial Trust": Plex Sans para rótulos e texto, Plex Mono para
// o readout numérico (tabular, sem ligaduras). next/font baixa no build e serve
// do próprio domínio — nenhum request a fonts.googleapis.com em runtime.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono"
});

export const viewport: Viewport = {
  themeColor: "#0b0e15"
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
  const theme = await readTheme();
  return (
    <html lang="pt-BR" data-theme={theme} className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
