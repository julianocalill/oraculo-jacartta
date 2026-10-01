"use server";

import { assertTabAccess } from "../../lib/auth/access";
import { revalidatePath } from "../../lib/operation-navigation";
import { importTikTokReturns, type UploadReport } from "../../lib/returns-upload";
import { TIKTOK_ACCOUNTS, type TikTokAccount } from "../../lib/returns-import";

export async function uploadReturns(
  _previous: UploadReport | null,
  formData: FormData
): Promise<UploadReport> {
  const user = await assertTabAccess("devolucoes");
  const file = formData.get("file");
  const account = formData.get("account");
  const report: UploadReport = {
    batchId: null, fileName: file instanceof File ? file.name : "",
    sheets: [], rowsRead: 0, rowsWritten: 0, rowsRejected: 0, duplicates: 0,
    byStatus: {}, byType: {}, qtyAssumed: 0, unknownReasons: [], errors: []
  };
  if (!(file instanceof File) || !file.size || !/\.xlsx$/i.test(file.name)) {
    return { ...report, failure: "Selecione um arquivo .xlsx de devoluções do TikTok." };
  }
  if (account && !TIKTOK_ACCOUNTS.includes(account as TikTokAccount)) {
    return { ...report, failure: "Selecione uma loja válida." };
  }
  try {
    const result = await importTikTokReturns(file, user.id ?? null, account ? account as TikTokAccount : undefined);
    await revalidatePath("/devolucoes");
    return result;
  } catch {
    return { ...report, failure: "Não foi possível ler ou importar o arquivo. Confira se é uma exportação .xlsx de devoluções do TikTok e tente novamente." };
  }
}
