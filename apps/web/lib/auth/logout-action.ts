"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies } from "./session";

// Sair: apaga os cookies de sessão e volta ao login. Usado pelo botão do
// cartão do usuário na sidebar (AppShell) e pela tela "Você já está conectado".
// Em dev não há login (getCurrentUser devolve o mock "Localhost" e /login
// redireciona para "/"), então lá o efeito é só voltar ao painel.
export async function logout() {
  await clearAuthCookies();
  redirect("/login");
}
