import "server-only";
import { headers } from "next/headers";
import { operationById, operationHref } from "@oraculo/domain/operations.js";

export type OperationId = "uberlandia" | "giracasa";

// Middleware overwrites the incoming header, including on unscoped URLs.
export async function getRequestOperation(): Promise<OperationId> {
  const value = (await headers()).get("x-oraculo-operation") ?? "uberlandia";
  if (!operationById(value)) throw new Error("Operação inválida.");
  return value as OperationId;
}

export async function scopedHref(href: string) {
  return operationHref(href, await getRequestOperation());
}
