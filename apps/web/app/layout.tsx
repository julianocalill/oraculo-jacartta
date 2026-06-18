import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Oraculo | Painel Operacional",
  description: "Painel operacional do Oraculo com dados reais do Supabase"
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
