import "server-only";
import { createSupabaseAdminClient } from "../supabase/admin";

// Fotos de perfil: bucket PRIVADO criado sob demanda (mesmo padrão do
// full-documents em app/full/actions.ts). A página nunca aponta para o
// Storage direto: usa /conta/avatar/<userId>, rota que exige sessão e
// redireciona para uma URL assinada curta.
export const AVATAR_BUCKET = "user-avatars";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export async function ensureAvatarBucket() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.getBucket(AVATAR_BUCKET);
  if (!data && error) {
    const created = await admin.storage.createBucket(AVATAR_BUCKET, {
      public: false,
      fileSizeLimit: AVATAR_MAX_BYTES,
      allowedMimeTypes: Object.keys(AVATAR_MIME)
    });
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
  }
}

// O caminho fica em user_metadata.avatar_path. user_metadata é editável pelo
// próprio usuário via API do Supabase, então só vale caminho dentro da pasta
// dele — senão alguém apontaria o avatar para o arquivo de outra pessoa.
export function avatarPathOf(user: { id: string; user_metadata?: Record<string, unknown> | null }) {
  const path = user.user_metadata?.avatar_path;
  return typeof path === "string" && path.startsWith(`${user.id}/`) && !path.includes("..") ? path : null;
}

// URL estável por versão: o nome do arquivo muda a cada upload, então o
// ?v= muda junto e o navegador não mostra a foto antiga do cache.
export function avatarUrl(user: { id: string; user_metadata?: Record<string, unknown> | null }) {
  const path = avatarPathOf(user);
  if (!path) return null;
  return `/conta/avatar/${encodeURIComponent(user.id)}?v=${encodeURIComponent(path.slice(user.id.length + 1))}`;
}
