import "./globals.css";
import type { Metadata, Viewport } from "next";

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

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
