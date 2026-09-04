import { operationIsReady } from "../operation-status";
import "server-only";
import { headers } from "next/headers";
import { operationById } from "@oraculo/domain/operations.js";
import { getCurrentUser } from "../auth/session";
import { getRequestOperation, type OperationId } from "../operation-context";

/** The explicit variant is for server caches, whose callers authorize first. */
export function operationFetch(explicitOperation?: OperationId): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.startsWith("/rest/v1/")) return fetch(input, init);
    const operation = explicitOperation ?? await getRequestOperation();
    const descriptor = operationById(operation);
    if (!descriptor) throw new Error("Operação inválida.");
    if (!explicitOperation) {
      const path = (await headers()).get("x-oraculo-path") ?? "";
      // Existing public QR documents remain public; their route only exposes a pallet.
      if (!path.startsWith("/logistica/palete/")) {
        if (!(await operationIsReady(operation))) throw new Error("Operação em preparação.");
        const user = await getCurrentUser();
        if (!user || !user.oraculo_operation_allowed) throw new Error("Sem acesso à operação.");
      }
    }
    const requestHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    requestHeaders.set("Accept-Profile", descriptor.schema);
    requestHeaders.set("Content-Profile", descriptor.schema);
    return fetch(input, { ...init, headers: requestHeaders });
  };
}
