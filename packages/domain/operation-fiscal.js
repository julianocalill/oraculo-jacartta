import { operationById } from "./operations.js";
import { calcNetCostByOrigin, calcNetCost, calcPisCofins, calcDifal, icmsRateForUf } from "./fiscal.js";

/** Invoice-based contract. The legacy standalone calculator is unchanged. */
export function calcOperationFiscalOrder({ operationId, invoiceValue, grossCost, netCost,
  recoverableTaxes, isImportedTransfer = false, origin, destState,
  marketplaceFee, expenses = 0, pisCofinsRate = 9.25, pisCofinsCreditEnabled,
  difalOverrideAmount, difalOverrideRate } = {}) {
  const operation = operationById(operationId);
  if (!operation) throw new Error("Operação financeira obrigatória e válida.");
  const valid = (value) => value != null && Number.isFinite(Number(value));
  const base = valid(invoiceValue) ? Number(invoiceValue) : null;
  const sp = operationId === "giracasa";
  // Financeiro: explicit net > explicit recoverable taxes > imported transfer > gross.
  const costResult = sp
    ? calcNetCost({ grossTotal: grossCost, netTotal: netCost, recoverableTaxes,
      isImportedTransfer: recoverableTaxes == null && isImportedTransfer && origin === "importado" })
    : { total: valid(netCost) ? Number(netCost) : calcNetCostByOrigin(grossCost, origin), rule: "jacarta_origin_credit" };
  const cost = costResult.total;
  const icmsRate = icmsRateForUf({ profile: operation.profile, origin, uf: destState });
  const pending = base == null || base < 0 || cost == null || cost <= 0 || icmsRate == null || !valid(marketplaceFee);
  const icms = base == null || icmsRate == null ? null : base * icmsRate / 100;
  const pisCofins = base == null || cost == null ? null : calcPisCofins({ base, netCost: cost,
    rate: pisCofinsRate, creditEnabled: pisCofinsCreditEnabled ?? sp });
  const intrastate = String(destState ?? "").toUpperCase() === String(operation.state).toUpperCase();
  const difal = base == null || icmsRate == null ? null : intrastate ? 0 : calcDifal({ base, destState,
    sourceState: operation.state, origin, explicitAmount: difalOverrideAmount, explicitRate: difalOverrideRate }).amount;
  const taxesTotal = icms == null || pisCofins == null || difal == null ? null : icms + pisCofins + difal;
  const profit = pending ? null : base - cost - taxesTotal - Number(marketplaceFee) - Number(expenses);
  return { operationId, profile: operation.profile, ruleVersion: `${operation.profile}-v1`, base,
    cost, costRule: costResult.rule, icms, pisCofins, difal, taxesTotal, pending, profit,
    margin: profit == null || base <= 0 ? null : profit / base,
    roi: profit == null || cost <= 0 ? null : profit / cost };
}
