/** Operation identifiers are stable; a URL or cookie never grants membership. */
export const OPERATIONS = Object.freeze([
  { id: "uberlandia", label: "Uberlândia/MG", schema: "public", profile: "jacarta", state: "MG" },
  { id: "giracasa", label: "Giracasa — São Paulo", schema: "giracasa", profile: "gira-casa", state: "SP" }
]);

export function operationById(id) {
  return OPERATIONS.find((operation) => operation.id === id) ?? null;
}

export function parseOperationPath(path) {
  const match = /^\/o\/([^/?#]+)(\/[^?#]*)?([?#].*)?$/.exec(path);
  if (!match) return { operation: null, path };
  return { operation: operationById(match[1]), path: `${match[2] || "/"}${match[3] || ""}` };
}

export function operationHref(href, operation = "uberlandia") {
  if (!operationById(operation)) throw new Error("Operação inválida.");
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
  if (/^\/(o\/|login(?:[/?#]|$)|operacoes(?:[/?#]|$)|politica-de-dados|termos-de-servico|_next\/|brand\/)/.test(href)) return href;
  return `/o/${operation}${href === "/" ? "" : href}`;
}

/** Only server-managed app_metadata is used. Absence is a legacy MG account. */
export function operationGrant(user, operation) {
  if (!user || !operationById(operation)) return null;
  const metadata = user.app_metadata ?? {};
  if (metadata.operations && typeof metadata.operations === "object") {
    const grant = metadata.operations[operation];
    return grant?.enabled === true ? grant : null;
  }
  return operation === "uberlandia"
    ? {
        enabled: true,
        tabs: metadata.tabs ?? [],
        restricted_tabs: metadata.restricted_tabs ?? [],
        full_manager: metadata.full_manager === true
      }
    : null;
}

export function userOperations(user) {
  return OPERATIONS.filter((operation) => operationGrant(user, operation.id));
}

export function projectOperationUser(user, operation) {
  if (!user) return null;
  const grant = operationGrant(user, operation);
  return {
    ...user,
    oraculo_operation: operation,
    oraculo_operation_allowed: grant !== null,
    app_metadata: {
      ...user.app_metadata,
      tabs: grant?.tabs ?? [],
      restricted_tabs: grant?.restricted_tabs ?? [],
      full_manager: grant?.full_manager === true
    }
  };
}
