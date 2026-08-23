import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "./theme";

// Tema escolhido pelo usuário (toggle na sidebar). Lido do cookie no servidor
// para o HTML já sair com o data-theme certo — sem flash de dark→light.
export async function readTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === "light" ? "light" : "dark";
}
