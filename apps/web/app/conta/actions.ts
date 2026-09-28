"use server";

import { randomUUID } from "node:crypto";
import { createSupabaseAuthClient, requireCurrentUser } from "../../lib/auth/session";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { redirect, revalidatePath } from "../../lib/operation-navigation";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_MIME, avatarPathOf, ensureAvatarBucket } from "../../lib/auth/avatar";

// Ações da tela Minha conta. Cada uma age SÓ sobre o usuário da sessão — o
// id nunca vem do formulário. Escrita via service role (auth admin API),
// como em /usuarios. O resultado volta na URL (?ok= / ?erro=) com códigos
// fixos; a página traduz o código em texto.

// Em dev não existe conta de verdade (getCurrentUser devolve o mock
// "local-dev"), então não há o que alterar no Supabase.
async function requireRealUser() {
  const user = await requireCurrentUser();
  if (user.id === "local-dev") await redirect("/conta?erro=dev");
  return user;
}

export async function updateName(formData: FormData) {
  const user = await requireRealUser();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  if (!fullName) await redirect("/conta?erro=nome-vazio");

  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(user.id, {
    user_metadata: { full_name: fullName }
  });
  if (error) await redirect("/conta?erro=falha");
  await revalidatePath("/conta");
  await redirect("/conta?ok=nome");
}

export async function uploadAvatar(formData: FormData) {
  const user = await requireRealUser();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) await redirect("/conta?erro=foto-vazia");
  const photo = file as File;
  const extension = AVATAR_MIME[photo.type];
  if (!extension) await redirect("/conta?erro=foto-formato");
  if (photo.size > AVATAR_MAX_BYTES) await redirect("/conta?erro=foto-tamanho");

  await ensureAvatarBucket();
  const admin = createSupabaseAdminClient();
  const previous = avatarPathOf(user);
  // Nome novo a cada envio: muda a URL (?v=) e fura o cache do navegador.
  const path = `${user.id}/${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const uploaded = await admin.storage.from(AVATAR_BUCKET).upload(path, photo, {
    contentType: photo.type,
    upsert: false
  });
  if (uploaded.error) await redirect("/conta?erro=falha");

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_path: path }
  });
  if (error) {
    await admin.storage.from(AVATAR_BUCKET).remove([path]);
    await redirect("/conta?erro=falha");
  }
  if (previous) await admin.storage.from(AVATAR_BUCKET).remove([previous]);
  await revalidatePath("/conta");
  await redirect("/conta?ok=foto");
}

export async function removeAvatar() {
  const user = await requireRealUser();
  const previous = avatarPathOf(user);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_path: null }
  });
  if (error) await redirect("/conta?erro=falha");
  if (previous) await admin.storage.from(AVATAR_BUCKET).remove([previous]);
  await revalidatePath("/conta");
  await redirect("/conta?ok=foto-removida");
}

export async function changePassword(formData: FormData) {
  const user = await requireRealUser();
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current || !next) await redirect("/conta?erro=senha-vazia");
  if (next.length < 8) await redirect("/conta?erro=senha-curta");
  if (next !== confirm) await redirect("/conta?erro=senha-diferente");
  if (next === current) await redirect("/conta?erro=senha-igual");

  // Confere a senha atual antes de trocar: sessão aberta num computador
  // esquecido não basta para tomar a conta.
  const check = await createSupabaseAuthClient().auth.signInWithPassword({
    email: user.email ?? "",
    password: current
  });
  if (check.error) await redirect("/conta?erro=senha-atual");

  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(user.id, { password: next });
  if (error) await redirect("/conta?erro=falha");
  await redirect("/conta?ok=senha");
}
