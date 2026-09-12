import { NextResponse } from "next/server";
import { canAccessRequest, isFullManager } from "../../../../../lib/auth/access";
import { requireCurrentUser } from "../../../../../lib/auth/session";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { effectiveUserId } from "../../../../../lib/users";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const user = await requireCurrentUser();
  if (!(await canAccessRequest(user, "full"))) return new NextResponse("Sem acesso", { status: 403 });
  const { id, attachmentId } = await params;
  const admin = createSupabaseAdminClient();
  if (!isFullManager(user)) {
    const { data: participant } = await admin.from("oraculo_full_participants").select("full_id").eq("full_id", id).eq("user_id", effectiveUserId(user)).maybeSingle();
    if (!participant) return new NextResponse("Sem acesso", { status: 403 });
  }
  const { data: attachment, error } = await admin.from("oraculo_full_attachments").select("storage_path").eq("id", attachmentId).eq("full_id", id).maybeSingle();
  if (error || !attachment) return new NextResponse("Arquivo não encontrado", { status: 404 });
  const signed = await admin.storage.from("full-documents").createSignedUrl(attachment.storage_path, 60);
  if (signed.error) return new NextResponse("Não foi possível abrir o arquivo", { status: 502 });
  return NextResponse.redirect(signed.data.signedUrl);
}
