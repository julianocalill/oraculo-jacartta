// RPA — Recibo de Pagamento a Autônomo para os afiliados da Shopee.
//
// Desde 01/07/2026 a Shopee repassa a comissão do Programa de Afiliados do
// Vendedor em valor BRUTO e não retém tributo na fonte: ela se declara mera
// intermediária do pagamento. A responsabilidade fiscal pelo afiliado pessoa
// física passou a ser do vendedor, que é o tomador do serviço.
//
// Este módulo é a especificação executável dessas retenções. Como em
// `fiscal.js`, a intenção é travar as fórmulas contra regressão via testes
// (`rpa.test.js`) e manter os números fiscais num lugar só.
//
// TUDO EM CENTAVOS INTEIROS. Dinheiro em float acumula erro, e aqui o total da
// tela precisa bater centavo a centavo com a soma de centenas de PDFs — o
// consolidado é a soma dos valores JÁ arredondados por linha, nunca o
// arredondamento de uma soma.

/** Alíquota do INSS retida pelo tomador do contribuinte individual. */
export const INSS_RATE = 0.11;

/**
 * Teto do salário-de-contribuição. Acima disso a base do INSS trava, então a
 * retenção máxima é `INSS_CEILING_CENTS * INSS_RATE`.
 */
export const INSS_CEILING_CENTS = 815741; // R$ 8.157,41

/**
 * Tabela progressiva mensal do IRRF.
 *
 * ⚠️ Confirmar com a contabilidade antes de tratar o resultado como definitivo.
 * A reforma de 2025 manteve as faixas progressivas e acrescentou um REDUTOR que
 * zera o imposto até R$ 5.000,00 de rendimento mensal e o reintroduz
 * gradualmente até R$ 7.350,00. Os coeficientes exatos do faseamento variam
 * entre as fontes públicas; aqui ele é modelado como interpolação linear entre
 * os dois limites, que reproduz o efeito descrito (zero em 5.000, imposto
 * integral em 7.350).
 *
 * Na prática isso raramente é exercitado pelo relatório da Shopee: a maior
 * comissão individual de Jul/2026 foi R$ 4.087,10, abaixo do piso do redutor.
 *
 * Ressalva estrutural: o redutor olha o rendimento mensal TOTAL da pessoa, que
 * o tomador não conhece. Cada fonte pagadora retém sobre o que ela mesma paga —
 * o acerto acontece no ajuste anual.
 */
export const IRRF_TABLE = {
  vigenciaInicio: "2026-01-01",
  label: "Tabela progressiva mensal + redutor (vigência 2026)",
  /** Faixas sobre a base (bruto − INSS). `upToCents: null` = última faixa. */
  brackets: [
    { upToCents: 242880, rate: 0, deductionCents: 0 },
    { upToCents: 282665, rate: 0.075, deductionCents: 18216 },
    { upToCents: 375105, rate: 0.15, deductionCents: 39416 },
    { upToCents: 466468, rate: 0.225, deductionCents: 67549 },
    { upToCents: null, rate: 0.275, deductionCents: 90873 }
  ],
  redutor: {
    isencaoAteCents: 500000, // R$ 5.000,00 — imposto zerado
    faseamentoAteCents: 735000 // R$ 7.350,00 — imposto integral
  }
};

/** Arredonda para centavo inteiro, meio para cima, sem herdar ruído de float. */
export function roundCents(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value + (value >= 0 ? 1e-6 : -1e-6));
}

/** Retenção do INSS: 11% sobre o bruto, com a base travada no teto. */
export function calcInssCents(grossCents) {
  const base = Math.min(Math.max(grossCents, 0), INSS_CEILING_CENTS);
  return roundCents(base * INSS_RATE);
}

/**
 * Retenção do IRRF sobre a base (bruto − INSS), com o redutor de 2026 aplicado
 * em cima do imposto da tabela progressiva.
 */
export function calcIrrfCents(baseCents, table = IRRF_TABLE) {
  const base = Math.max(baseCents, 0);
  const bracket =
    table.brackets.find((b) => b.upToCents === null || base <= b.upToCents) ??
    table.brackets[table.brackets.length - 1];
  const imposto = Math.max(roundCents(base * bracket.rate - bracket.deductionCents), 0);
  if (imposto === 0) return 0;

  const { isencaoAteCents, faseamentoAteCents } = table.redutor ?? {};
  if (isencaoAteCents == null || faseamentoAteCents == null) return imposto;
  if (base <= isencaoAteCents) return 0;
  if (base >= faseamentoAteCents) return imposto;

  // Faseamento: o redutor cobre 100% do imposto no piso e 0% no topo.
  const faixa = faseamentoAteCents - isencaoAteCents;
  const proporcaoTributada = (base - isencaoAteCents) / faixa;
  return Math.max(roundCents(imposto * proporcaoTributada), 0);
}

/** Retenção do ISS: alíquota única informada no lote, sobre o bruto. */
export function calcIssCents(grossCents, rate) {
  const aliquota = Number(rate);
  if (!Number.isFinite(aliquota) || aliquota <= 0) return 0;
  return roundCents(Math.max(grossCents, 0) * (aliquota / 100));
}

/**
 * Aplica as retenções ligadas no lote. Com todas desligadas o líquido é o
 * próprio bruto — é o modo "só o valor bruto para a contabilidade calcular".
 *
 * @param {object} params
 * @param {number} params.grossCents  comissão bruta em centavos
 * @param {boolean} params.inss       reter INSS 11%
 * @param {boolean} params.irrf       reter IRRF pela tabela progressiva
 * @param {boolean} params.iss        reter ISS
 * @param {number} params.issRate     alíquota do ISS em % (ex.: 2 = 2%)
 */
export function computeRetentions({
  grossCents,
  inss = false,
  irrf = false,
  iss = false,
  issRate = 0,
  irrfTable = IRRF_TABLE
}) {
  const gross = Math.max(Math.trunc(grossCents) || 0, 0);
  const inssCents = inss ? calcInssCents(gross) : 0;
  const irrfCents = irrf ? calcIrrfCents(gross - inssCents, irrfTable) : 0;
  const issCents = iss ? calcIssCents(gross, issRate) : 0;
  const netCents = gross - inssCents - irrfCents - issCents;
  return { grossCents: gross, inssCents, irrfCents, issCents, netCents };
}

/** Soma um conjunto de linhas já calculadas. Nunca recalcula a partir do total. */
export function sumRetentions(rows) {
  return rows.reduce(
    (acc, row) => ({
      grossCents: acc.grossCents + (row.grossCents ?? 0),
      inssCents: acc.inssCents + (row.inssCents ?? 0),
      irrfCents: acc.irrfCents + (row.irrfCents ?? 0),
      issCents: acc.issCents + (row.issCents ?? 0),
      netCents: acc.netCents + (row.netCents ?? 0)
    }),
    { grossCents: 0, inssCents: 0, irrfCents: 0, issCents: 0, netCents: 0 }
  );
}

// ---------------------------------------------------------------------------
// Normalização do relatório da Shopee
// ---------------------------------------------------------------------------

/**
 * Remove caracteres invisíveis de formatação e controle.
 *
 * O relatório traz o telefone prefixado com U+200C (zero-width non-joiner):
 * `"‌+55-19998611456"`. Invisível na tela, quebra comparação e vaza para
 * dentro do PDF.
 */
export function sanitizeText(value) {
  if (value == null) return "";
  return String(value)
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Controle (C0/C1), soft hyphen, zero-width, marcas bidi, word joiner e BOM.
 * Escrito com escapes porque, por definição, esses caracteres não aparecem no
 * editor — um literal aqui seria invisível e impossível de revisar.
 */
const INVISIBLE_CHARS = new RegExp(
  "[" +
    "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F" +
    "\\u00AD" +
    "\\u200B-\\u200F" +
    "\\u2028\\u2029" +
    "\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F" +
    "\\uFEFF" +
    "]",
  "g"
);

/** Só os dígitos — para CPF, CNPJ, CEP e telefone. */
export function onlyDigits(value) {
  return sanitizeText(value).replace(/\D/g, "");
}

/** 28473401816 -> 284.734.018-16 (devolve a entrada limpa se não tiver 11 dígitos). */
export function formatCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return sanitizeText(value);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** 12345678000199 -> 12.345.678/0001-99 */
export function formatCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return sanitizeText(value);
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/**
 * Valida CPF pelos dígitos verificadores. Só serve para sinalizar linha
 * suspeita no relatório de importação — nunca para descartar o afiliado, que
 * pode ter o valor certo digitado errado na Shopee.
 */
export function isValidCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(digits[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

const ADDRESS_PATTERN =
  /^(.*?),\s*(.*?),\s*(.*?)\s+-\s+(.*?),\s*(.*?)\s+-\s+(.*?),\s*(\d{5}-?\d{3})$/;

/**
 * Quebra o endereço, que vem numa string única:
 *   "R 46, 220, Apt 3401 - Jardim Goiás, Goiânia - Goiás, 74805-440"
 *
 * O formato casou em 772/772 linhas do relatório de Jul/2026, mas a Shopee pode
 * mudar sem avisar: quando não casa, `parsed` é false e o RPA imprime a string
 * crua. Endereço errado no recibo é pior que endereço não estruturado.
 */
export function parseAffiliateAddress(raw) {
  const clean = sanitizeText(raw);
  const fallback = {
    parsed: false,
    raw: clean,
    logradouro: clean,
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: ""
  };
  if (!clean) return fallback;
  const match = clean.match(ADDRESS_PATTERN);
  if (!match) return fallback;
  const [, logradouro, numero, complemento, bairro, cidade, uf, cep] = match;
  return {
    parsed: true,
    raw: clean,
    logradouro: logradouro.trim(),
    numero: numero.trim(),
    complemento: complemento.trim(),
    bairro: bairro.trim(),
    cidade: cidade.trim(),
    uf: uf.trim(),
    cep: cep.replace(/(\d{5})-?(\d{3})/, "$1-$2")
  };
}

/** Uma linha de endereço legível para o recibo. */
export function formatAddressLine(address) {
  if (!address?.parsed) return address?.raw ?? "";
  const partes = [
    [address.logradouro, address.numero].filter(Boolean).join(", "),
    address.complemento,
    address.bairro,
    [address.cidade, address.uf].filter(Boolean).join(" - "),
    address.cep
  ];
  return partes.filter((p) => p && p.length > 0).join(" · ");
}

const MONTHS = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12
};

/**
 * "Jul 2026" -> "2026-07-01". Aceita pt-BR e en, porque o relatório sai no
 * idioma da conta da Shopee. Devolve null se não reconhecer.
 */
export function parseCompetencia(value) {
  const clean = sanitizeText(value).toLowerCase();
  const match = clean.match(/^([a-zçã]{3,})\.?\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS[match[1].slice(0, 3)];
  if (!month) return null;
  return `${match[2]}-${String(month).padStart(2, "0")}-01`;
}

/** "2026-07-01" -> "Julho/2026" */
export function formatCompetencia(iso) {
  const nomes = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const match = String(iso ?? "").match(/^(\d{4})-(\d{2})/);
  if (!match) return String(iso ?? "");
  return `${nomes[Number(match[2]) - 1]}/${match[1]}`;
}

/** Centavos -> "R$ 1.234,56" */
export function formatBRL(cents) {
  const value = (Math.trunc(cents) || 0) / 100;
  return `R$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

// ---------------------------------------------------------------------------
// Valor por extenso — recibo pede, e não vale trazer dependência para isso
// ---------------------------------------------------------------------------

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
  "dezessete", "dezoito", "dezenove"
];
const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
  "oitenta", "noventa"
];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos"
];

function trioPorExtenso(n) {
  if (n === 100) return "cem";
  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

function inteiroPorExtenso(n) {
  if (n === 0) return "zero";
  const escalas = [
    { valor: 1_000_000_000, sing: "bilhão", plur: "bilhões" },
    { valor: 1_000_000, sing: "milhão", plur: "milhões" },
    { valor: 1_000, sing: "mil", plur: "mil" }
  ];
  // Cada parte carrega se é "redonda": grupos de escala sempre são, e o trio
  // final só quando não passa de cem ou é centena exata. A conjunção "e"
  // depende disso — "mil e duzentos", mas "dois mil, cento e dez".
  const partes = [];
  let restante = n;
  for (const escala of escalas) {
    const quantos = Math.floor(restante / escala.valor);
    if (quantos > 0) {
      const prefixo = escala.valor === 1_000 && quantos === 1 ? "" : `${trioPorExtenso(quantos)} `;
      partes.push({ texto: `${prefixo}${quantos === 1 ? escala.sing : escala.plur}`, redondo: true });
      restante %= escala.valor;
    }
  }
  if (restante > 0) {
    partes.push({ texto: trioPorExtenso(restante), redondo: restante < 100 || restante % 100 === 0 });
  }

  const ultimo = partes.pop();
  if (partes.length === 0) return ultimo.texto;
  return `${partes.map((p) => p.texto).join(", ")}${ultimo.redondo ? " e " : ", "}${ultimo.texto}`;
}

/** 408710 -> "quatro mil e oitenta e sete reais e dez centavos" */
export function numeroPorExtenso(cents) {
  const total = Math.abs(Math.trunc(cents) || 0);
  const reais = Math.floor(total / 100);
  const centavos = total % 100;
  const partes = [];
  if (reais > 0 || centavos === 0) {
    const extenso = inteiroPorExtenso(reais);
    // "um milhão DE reais", mas "um milhão e quinhentos mil reais": a
    // preposição só entra quando a escala é a última palavra.
    const ligacao = /(milhão|milhões|bilhão|bilhões)$/.test(extenso) ? " de" : "";
    partes.push(`${extenso}${ligacao} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return partes.join(" e ");
}
