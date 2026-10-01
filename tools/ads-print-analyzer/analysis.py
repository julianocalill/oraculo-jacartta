"""Leitura de prints Shopee Ads e recomendações auditáveis, sem alterar campanhas."""

from __future__ import annotations

import re
import json
import subprocess
import unicodedata
from datetime import date
from pathlib import Path
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


def analyze(data: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Reusa a regra canônica do Oráculo; o protótipo só faz OCR nativo."""
    runner = Path(__file__).resolve().with_name("analyze.mjs")
    request = json.dumps({"data": data, "today": (today or date.today()).isoformat()}, ensure_ascii=False)
    try:
        result = subprocess.run(
            ["node", str(runner)], input=request, capture_output=True, text=True, timeout=10
        )
    except FileNotFoundError as error:
        raise RuntimeError("Node.js é necessário para calcular os cenários.") from error
    if result.returncode:
        raise RuntimeError("Não foi possível analisar a campanha: " + result.stderr[-500:])
    return json.loads(result.stdout)
