"""Leitura de prints Shopee Ads e recomendações auditáveis, sem alterar campanhas."""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any


METRIC_LABELS = {
    "impressions": "impressoes",
    "clicks": "cliques",
    "ctr": "ctr",
    "items_sold": "itens vendidos",
    "sales": "vendas",
    "spend": "investimento",
    "roas": "roas",
}


def normalized(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", value.lower())
        if unicodedata.category(char) != "Mn"
    ).strip()


def number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if 0 <= float(value) < 1e12 else None
    text = str(value).strip().lower().replace("r$", "").replace(" ", "")
    if not text:
        return None
    multiplier = 1000 if text.endswith("k") else 1
    if multiplier > 1:
        text = text[:-1]
    text = text.removesuffix("%")
    if not re.fullmatch(r"\d[\d.,]*", text):
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif text.count(".") > 1 or re.fullmatch(r"\d{1,3}\.\d{3}", text):
        text = text.replace(".", "")
    try:
        result = float(text) * multiplier
        return result if 0 <= result < 1e12 else None
    except ValueError:
        return None


def _label_matches(line: str, label: str) -> bool:
    text = normalized(line)
    if label == "vendas":
        return text.startswith("vendas") and "cupom" not in text
    if label == "roas":
        return text.startswith("roas") and "meta" not in text
    return text.startswith(label)


def extract_metrics(lines: list[dict[str, Any]]) -> dict[str, Any]:
    """Lê os cards superiores pelo alinhamento espacial, sem confundir com o gráfico."""
    top = [line for line in lines if line.get("y", 1) < 0.52 and line.get("text")]
    metrics: dict[str, Any] = {key: None for key in METRIC_LABELS}
    raw: dict[str, str] = {}
    for key, label in METRIC_LABELS.items():
        candidates = [line for line in top if _label_matches(str(line["text"]), label)]
        if not candidates:
            continue
        # O primeiro card visível é a fonte; linhas de tabela mais abaixo não entram.
        title = min(candidates, key=lambda line: line["y"])
        below = [line for line in top
                 if 0.008 < line["y"] - title["y"] < 0.09
                 and abs(line["x"] - title["x"]) < 0.065
                 and number(line["text"]) is not None]
        if not below:
            continue
        value = min(below, key=lambda line: (line["y"] - title["y"], abs(line["x"] - title["x"])))
        metrics[key] = number(value["text"])
        raw[key] = str(value["text"])

    period = None
    for line in top:
        match = re.search(r"(\d{1,2}/\d{1,2})\s*[-–]\s*(\d{1,2}/\d{1,2})", str(line["text"]))
        if match:
            period = {"start": match.group(1), "end": match.group(2), "label": str(line["text"])}
            break

    return {"metrics": metrics, "raw": raw, "period": period, "recognized_lines": len(lines)}


def _iso_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) and value else None
    except ValueError:
        return None


def _rounded(value: float) -> float:
    return round(value + 1e-9, 2)


def br(value: float, decimals: int = 2) -> str:
    return f"{value:,.{decimals}f}".replace(",", "§").replace(".", ",").replace("§", ".")


def analyze(data: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """A matriz de 4 cenários só é confirmada com janela e orçamento comparáveis."""
    today = today or date.today()
    values = data.get("metrics") or {}
    metrics = {key: number(values.get(key)) for key in METRIC_LABELS}
    spend, sales = metrics["spend"], metrics["sales"]
    displayed_roas = metrics["roas"]
    calculated_roas = sales / spend if spend and sales is not None else None
    actual_roas = (calculated_roas if calculated_roas is not None else displayed_roas) if spend and spend > 0 else None
    target = number(data.get("target_roas"))
    if target is not None and target <= 0:
        target = None
    budget = number(data.get("daily_budget"))
    contribution = number(data.get("contribution_margin_pct"))
    if contribution is not None and not 0 < contribution <= 100:
        contribution = None
    budget_mode = data.get("budget_mode") if data.get("budget_mode") in ("limited", "unlimited", "unknown") else "unknown"
    consumed = data.get("budget_consumed") if data.get("budget_consumed") in ("yes", "no") else "unknown"
    start = _iso_date(data.get("period_start"))
    end = _iso_date(data.get("period_end"))
    optimized = _iso_date(data.get("last_optimization"))

    findings: list[str] = []
    actions: list[str] = []
    missing: list[str] = []
    warnings: list[str] = []
    scenario: int | None = None
    scenario_name = "Cenário ainda não confirmado"

    if spend is None or sales is None:
        missing.append("Confirme investimento e vendas lidos do print.")
    elif spend == 0:
        findings.append("O print não mostra gasto no período; não há ROAS útil para otimizar.")
    else:
        findings.append(f"R$ {br(spend)} investidos geraram R$ {br(sales)} em vendas atribuídas (ROAS {br(actual_roas)}×).")
        if displayed_roas is not None and calculated_roas is not None and abs(displayed_roas - calculated_roas) > max(0.1, calculated_roas * 0.05):
            warnings.append("O ROAS lido não confere com vendas ÷ investimento. Confira os três números no print; a análise usa o ROAS calculado.")

    if metrics["impressions"] and metrics["clicks"] is not None:
        ctr = 100 * metrics["clicks"] / metrics["impressions"]
        if metrics["ctr"] is not None and abs(metrics["ctr"] - ctr) > max(0.2, ctr * 0.15):
            warnings.append("CTR, cliques e impressões não fecham entre si. Os valores abreviados no print podem ser aproximados.")
    if metrics["items_sold"] is not None:
        findings.append("‘Itens vendidos’ mede unidades atribuídas, não pedidos; não use essa contagem como taxa de conversão de pedidos.")

    if target and actual_roas is not None:
        if actual_roas >= target:
            findings.append(f"O ROAS do print atinge a meta informada de {br(target)}×.")
        else:
            findings.append(f"O ROAS do print está abaixo da meta informada de {br(target)}×.")
            actions.append("Não aumente a verba apenas pelo volume de vendas. Confira preço, frete, foto principal, avaliações e margem de contribuição.")
    elif target is None:
        missing.append("Informe a meta de ROAS que valia no período do print.")

    break_even = 100 / contribution if contribution and contribution > 0 else None
    if break_even and actual_roas is not None:
        findings.append(f"Com margem de contribuição de {br(contribution, 1)}% antes de Ads, o ROAS de equilíbrio estimado é {br(break_even)}×.")
        if actual_roas < break_even:
            warnings.append("O ROAS está abaixo do equilíbrio estimado. Evite reduzir a meta ou elevar verba antes de corrigir a economia do produto.")
        else:
            findings.append("O ROAS supera o equilíbrio estimado; confirme custos, devoluções e atribuição antes de tratar isso como lucro líquido.")
    else:
        missing.append("Informe a margem de contribuição antes de Ads para avaliar a rentabilidade; ROAS sozinho não mede lucro.")

    if budget_mode == "unlimited":
        scenario_name = "Orçamento ilimitado: matriz de consumo não se aplica"
        findings.append("Com verba ilimitada não existe teto diário a ser consumido; classifique por retorno e margem, não por ‘gastou tudo’.")
    elif budget_mode == "unknown":
        missing.append("Informe se a campanha tinha orçamento diário limitado ou ilimitado. Um valor 0 na API não prova que era ilimitado.")
    elif budget is None or budget <= 0:
        missing.append("Informe o limite diário positivo da campanha.")
    elif consumed == "unknown":
        missing.append("Confirme no painel se a campanha consumiu todo o limite diário nos dias analisados.")

    if not start or not end or start > end:
        missing.append("Informe as datas inicial e final do print.")
    elif end >= today:
        missing.append("Use somente dias completos; retire o dia atual da análise de cenário.")
    if not optimized:
        missing.append("Informe a data da última otimização da campanha.")
    elif start and start <= optimized:
        missing.append("O print inclui dias anteriores ou iguais à última otimização. Gere outro começando no dia seguinte.")

    comparable = (
        spend is not None and spend > 0 and actual_roas is not None and target is not None and target > 0
        and budget_mode == "limited" and budget is not None and budget > 0
        and consumed != "unknown" and start is not None and end is not None
        and start <= end < today and optimized is not None and start > optimized
    )
    if comparable:
        reached = actual_roas >= target
        scenario = {("no", True): 1, ("no", False): 2, ("yes", False): 3, ("yes", True): 4}[(consumed, reached)]
        scenario_name = {
            1: "Cenário 1 · não consome e atinge a meta",
            2: "Cenário 2 · não consome e não atinge a meta",
            3: "Cenário 3 · consome e não atinge a meta",
            4: "Cenário 4 · consome e atinge a meta",
        }[scenario]
        if scenario == 1:
            actions.append(f"Teste reduzir a meta de ROAS de {br(target)}× para {br(_rounded(target * .8))}× e o teto diário de R$ {br(budget)} para R$ {br(_rounded(budget * .8))} (−20% cada).")
        elif scenario == 2:
            actions.append("Primeiro compare preço, frete e foto principal com concorrentes; corrija a oferta se necessário.")
            if break_even and actual_roas is not None and actual_roas < break_even:
                warnings.append("O treinamento sugere meta e orçamento −20% neste cenário, mas baixar a meta agora pode ampliar gasto abaixo do equilíbrio. Corrija a margem primeiro.")
            else:
                actions.append(f"Depois, teste meta de ROAS {br(_rounded(target * .8))}× e teto diário R$ {br(_rounded(budget * .8))} (−20% cada).")
        elif scenario == 3:
            actions.append(f"Revise preço e foto; teste elevar a meta de ROAS de {br(target)}× para {br(_rounded(target * 1.2))}× (+20%) e mantenha o teto de R$ {br(budget)}.")
        elif scenario == 4:
            if break_even and actual_roas is not None and actual_roas < break_even:
                warnings.append("Embora a meta tenha sido atingida, o ROAS está abaixo do equilíbrio informado. Não escale antes de rever a meta e a margem.")
            else:
                actions.append(f"Se houver estoque e margem, teste ampliar o teto diário de R$ {br(budget)} para R$ {br(_rounded(budget * 1.2))} (+20%) mantendo a meta; acompanhe dias completos após a mudança.")

    if not scenario:
        actions.append("Reúna os dados pendentes antes de aplicar a regra dos quatro cenários. Enquanto isso, acompanhe o ROAS e limite perdas conforme a margem do produto.")
    if data.get("recent_price_change"):
        findings.append("Preço ou frete mudou recentemente: compare apenas dias completos depois dessa alteração antes de atribuir a mudança de ROAS a ela.")
    if data.get("low_stock"):
        actions.append("Cheque o estoque disponível antes de escalar a entrega do anúncio.")
    if not metrics["impressions"] or metrics["clicks"] is None:
        missing.append("Confira impressões e cliques se quiser diagnosticar entrega e atração do anúncio.")

    return {
        "scenario": scenario,
        "scenario_name": scenario_name,
        "roas_used": round(actual_roas, 4) if actual_roas is not None else None,
        "break_even_roas": round(break_even, 4) if break_even else None,
        "findings": findings,
        "actions": list(dict.fromkeys(actions)),
        "missing": list(dict.fromkeys(missing)),
        "warnings": list(dict.fromkeys(warnings)),
        "basis": "Print fornecido pelo usuário e Aula 09 do Software Shopee ADS 2.0; sem consulta à API nesta aplicação local.",
    }
