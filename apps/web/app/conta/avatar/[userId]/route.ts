import { NextResponse } from "next/server";
import { requireCurrentUser } from "../../../../lib/auth/session";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { AVATAR_BUCKET, avatarPathOf } from "../../../../lib/auth/avatar";

// Foto de perfil de qualquer usuário, para quem estiver logado (as fotos
// aparecem na sidebar e podem aparecer em listas de pessoas). Redireciona
// para URL assinada de 1h; o redirect fica em cache privado por 50 min.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  await requireCurrentUser();
  const { userId } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return new NextResponse("Não encontrado", { status: 404 });
  const path = avatarPathOf(data.user);
  if (!path) return new NextResponse("Sem foto", { status: 404 });
  const signed = await admin.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (signed.error) return new NextResponse("Não foi possível abrir a foto", { status: 502 });
  const response = NextResponse.redirect(signed.data.signedUrl);
  response.headers.set("Cache-Control", "private, max-age=3000");
  return response;
}
