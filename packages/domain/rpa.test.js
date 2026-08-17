import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSS_RATE,
  INSS_CEILING_CENTS,
  IRRF_TABLE,
  roundCents,
  calcInssCents,
  calcIrrfCents,
  calcIssCents,
  computeRetentions,
  sumRetentions,
  sanitizeText,
  onlyDigits,
  formatCpf,
  formatCnpj,
  isValidCpf,
  parseAffiliateAddress,
  formatAddressLine,
  parseCompetencia,
  formatCompetencia,
  formatBRL,
  numeroPorExtenso
} from "./rpa.js";

// ---------------------------------------------------------------------------
// Retenções
// ---------------------------------------------------------------------------

test("INSS: 11% do bruto, arredondado ao centavo", () => {
  // R$ 3,23 * 11% = R$ 0,3553 -> R$ 0,36
  assert.equal(calcInssCents(323), 36);
  // R$ 4.087,10 * 11% = R$ 449,581 -> R$ 449,58
  assert.equal(calcInssCents(408710), 44958);
  assert.equal(calcInssCents(0), 0);
});

test("INSS: a base trava no teto do salário-de-contribuição", () => {
  const noTeto = calcInssCents(INSS_CEILING_CENTS);
  assert.equal(calcInssCents(INSS_CEILING_CENTS * 3), noTeto);
  assert.equal(noTeto, roundCents(INSS_CEILING_CENTS * INSS_RATE));
});

test("IRRF: o redutor de 2026 zera o imposto até R$ 5.000 de base", () => {
  // Maior comissão do relatório de Jul/2026, líquida de INSS.
  const base = 408710 - calcInssCents(408710);
  assert.ok(base < IRRF_TABLE.redutor.isencaoAteCents);
  assert.equal(calcIrrfCents(base), 0);
  // Exatamente no piso do redutor ainda é zero.
  assert.equal(calcIrrfCents(IRRF_TABLE.redutor.isencaoAteCents), 0);
});

test("IRRF: acima do topo do faseamento cobra a tabela progressiva cheia", () => {
  const base = 900000; // R$ 9.000,00, acima de R$ 7.350,00
  const esperado = roundCents(base * 0.275 - 90873);
  assert.equal(calcIrrfCents(base), esperado);
});

test("IRRF: dentro do faseamento o imposto é parcial e monotônico", () => {
  const { isencaoAteCents, faseamentoAteCents } = IRRF_TABLE.redutor;
  const meio = (isencaoAteCents + faseamentoAteCents) / 2;
  const noMeio = calcIrrfCents(meio);
  const noTopo = calcIrrfCents(faseamentoAteCents);
  assert.ok(noMeio > 0, "no meio da faixa já há imposto");
  assert.ok(noMeio < noTopo, "e ele é menor que o imposto cheio do topo");
});

test("ISS: alíquota percentual sobre o bruto, zero quando não informada", () => {
  assert.equal(calcIssCents(10000, 2), 200); // 2% de R$ 100,00
  assert.equal(calcIssCents(10000, 0), 0);
  assert.equal(calcIssCents(10000, null), 0);
});

test("computeRetentions: com tudo desligado, líquido é o próprio bruto", () => {
  const r = computeRetentions({ grossCents: 408710 });
  assert.equal(r.inssCents, 0);
  assert.equal(r.irrfCents, 0);
  assert.equal(r.issCents, 0);
  assert.equal(r.netCents, 408710);
});

test("computeRetentions: IRRF incide sobre a base já deduzida do INSS", () => {
  const grossCents = 900000;
  const comInss = computeRetentions({ grossCents, inss: true, irrf: true });
  const semInss = computeRetentions({ grossCents, inss: false, irrf: true });
  assert.ok(comInss.irrfCents < semInss.irrfCents);
  assert.equal(
    comInss.netCents,
    grossCents - comInss.inssCents - comInss.irrfCents
  );
});

test("consolidado é a soma das linhas já arredondadas, não o arredondamento da soma", () => {
  // Comissões reais do relatório de Jul/2026 (R$ 0,38 / R$ 0,43 / R$ 0,87).
  // Arredondar no fim daria R$ 0,18 de INSS; a soma dos recibos dá R$ 0,19.
  // No arquivo inteiro essa escolha vale 3 centavos de diferença — pouco, mas é
  // exatamente o tipo de divergência que a contabilidade devolve.
  const brutos = [38, 43, 87];
  const linhas = brutos.map((grossCents) => computeRetentions({ grossCents, inss: true }));
  const total = sumRetentions(linhas);

  assert.equal(total.inssCents, 4 + 5 + 10);
  assert.equal(roundCents(brutos.reduce((a, b) => a + b, 0) * INSS_RATE), 18);
  assert.notEqual(total.inssCents, 18);
  assert.equal(total.netCents, total.grossCents - total.inssCents);
});

// ---------------------------------------------------------------------------
// Normalização do relatório
// ---------------------------------------------------------------------------

test("sanitizeText remove o U+200C que a Shopee prefixa no telefone", () => {
  assert.equal(sanitizeText("‌+55-19998611456"), "+55-19998611456");
  assert.equal(sanitizeText("﻿Mês de conclusão"), "Mês de conclusão");
  assert.equal(sanitizeText("  dois   espaços  "), "dois espaços");
  assert.equal(sanitizeText(null), "");
});

test("onlyDigits e formatadores de documento", () => {
  assert.equal(onlyDigits("284.734.018-16"), "28473401816");
  assert.equal(formatCpf("28473401816"), "284.734.018-16");
  assert.equal(formatCnpj("12345678000199"), "12.345.678/0001-99");
  // Documento fora do tamanho volta limpo, não mascarado errado.
  assert.equal(formatCpf("123"), "123");
});

test("isValidCpf aceita dígito verificador correto e recusa repetido", () => {
  assert.equal(isValidCpf("284.734.018-16"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCpf("284.734.018-17"), false);
});

test("parseAffiliateAddress quebra o endereço em campos", () => {
  const a = parseAffiliateAddress(
    "R 46, 220, Apt 3401 - Jardim Goiás, Goiânia - Goiás, 74805-440"
  );
  assert.equal(a.parsed, true);
  assert.equal(a.logradouro, "R 46");
  assert.equal(a.numero, "220");
  assert.equal(a.complemento, "Apt 3401");
  assert.equal(a.bairro, "Jardim Goiás");
  assert.equal(a.cidade, "Goiânia");
  assert.equal(a.uf, "Goiás");
  assert.equal(a.cep, "74805-440");
});

test("parseAffiliateAddress aceita complemento vazio", () => {
  const a = parseAffiliateAddress(
    "R Prfa Marlilande de B Catanese, 180,  - Silvestre III, Amparo - São Paulo, 13905-420"
  );
  assert.equal(a.parsed, true);
  assert.equal(a.complemento, "");
  assert.equal(a.bairro, "Silvestre III");
  assert.equal(a.cidade, "Amparo");
});

test("parseAffiliateAddress cai no texto cru quando o formato muda", () => {
  const a = parseAffiliateAddress("Rua sem formato nenhum 123");
  assert.equal(a.parsed, false);
  assert.equal(a.logradouro, "Rua sem formato nenhum 123");
  // O recibo imprime a string crua em vez de um endereço quebrado errado.
  assert.equal(formatAddressLine(a), "Rua sem formato nenhum 123");
});

test("formatAddressLine monta uma linha legível sem campos vazios", () => {
  const a = parseAffiliateAddress(
    "R Prfa Marlilande de B Catanese, 180,  - Silvestre III, Amparo - São Paulo, 13905-420"
  );
  assert.equal(
    formatAddressLine(a),
    "R Prfa Marlilande de B Catanese, 180 · Silvestre III · Amparo - São Paulo · 13905-420"
  );
});

test("parseCompetencia aceita pt-BR e inglês", () => {
  assert.equal(parseCompetencia("Jul 2026"), "2026-07-01");
  assert.equal(parseCompetencia("ago 2026"), "2026-08-01");
  assert.equal(parseCompetencia("Dec 2026"), "2026-12-01");
  assert.equal(parseCompetencia("qualquer coisa"), null);
});

test("formatCompetencia e formatBRL saem em pt-BR", () => {
  assert.equal(formatCompetencia("2026-07-01"), "Julho/2026");
  assert.equal(formatBRL(408710), "R$ 4.087,10");
  assert.equal(formatBRL(38), "R$ 0,38");
  assert.equal(formatBRL(0), "R$ 0,00");
});

// ---------------------------------------------------------------------------
// Valor por extenso
// ---------------------------------------------------------------------------

test("numeroPorExtenso cobre os valores reais do relatório", () => {
  assert.equal(numeroPorExtenso(38), "trinta e oito centavos");
  assert.equal(numeroPorExtenso(100), "um real");
  assert.equal(numeroPorExtenso(323), "três reais e vinte e três centavos");
  assert.equal(numeroPorExtenso(0), "zero reais");
  assert.equal(numeroPorExtenso(1), "um centavo");
});

test("numeroPorExtenso nas escalas de centena, milhar e milhão", () => {
  assert.equal(numeroPorExtenso(10000), "cem reais");
  assert.equal(numeroPorExtenso(20000), "duzentos reais");
  assert.equal(numeroPorExtenso(100000), "mil reais");
  assert.equal(
    numeroPorExtenso(408710),
    "quatro mil e oitenta e sete reais e dez centavos"
  );
  assert.equal(numeroPorExtenso(2604508), "vinte e seis mil e quarenta e cinco reais e oito centavos");
});

test("numeroPorExtenso concorda a preposição da escala", () => {
  assert.equal(numeroPorExtenso(100000000), "um milhão de reais");
  assert.equal(numeroPorExtenso(200000000), "dois milhões de reais");
  // Com resto depois da escala, o "de" não entra.
  assert.equal(numeroPorExtenso(150000000), "um milhão e quinhentos mil reais");
});
