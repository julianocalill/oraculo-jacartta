import "server-only";
import { redirect as nextRedirect, type RedirectType } from "next/navigation";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { scopedHref } from "./operation-context";

export async function redirect(path: string, type?: RedirectType): Promise<never> {
  nextRedirect(await scopedHref(path), type);
}

export async function revalidatePath(path: string, type?: "layout" | "page") {
  nextRevalidatePath(await scopedHref(path), type);
}
