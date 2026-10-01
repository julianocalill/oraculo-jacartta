from datetime import date
from unittest import TestCase, main

from analysis import analyze, extract_metrics, number


TODAY = date(2026, 10, 1)
BASE = {
    "metrics": {"impressions": 212000, "clicks": 2900, "ctr": 1.35, "items_sold": 233,
                "sales": 21278.11, "spend": 2437.69, "roas": 8.73},
    "target_roas": 8,
    "period_start": "2026-09-21",
    "period_end": "2026-09-28",
    "previous_period_start": "2026-09-13",
    "previous_period_end": "2026-09-20",
    "previous_impressions": 180000,
    "previous_clicks": 2500,
    "last_optimization": "2026-09-20",
    "contribution_margin_pct": 20,
}


class AdsAnalysisTests(TestCase):
    def test_ocr_card_alignment_ignores_chart_legend(self):
        lines = [
            {"text": "Vendas", "x": .82, "y": .19}, {"text": "R$21.278,11", "x": .82, "y": .24},
            {"text": "Investimento", "x": .05, "y": .37}, {"text": "R$2.437,69", "x": .05, "y": .41},
            {"text": "ROAS", "x": .24, "y": .37}, {"text": "8,73", "x": .24, "y": .41},
            {"text": "ROAS", "x": .69, "y": .53},
            {"text": "21/09 - 28/09 (GMT-3)", "x": .69, "y": .07},
        ]
        result = extract_metrics(lines)
        self.assertEqual(result["metrics"]["spend"], 2437.69)
        self.assertEqual(result["metrics"]["sales"], 21278.11)
        self.assertEqual(result["metrics"]["roas"], 8.73)
        self.assertEqual(result["period"]["end"], "28/09")

    def test_brazilian_values_and_abbreviations(self):
        self.assertEqual(number("R$49.947,95"), 49947.95)
        self.assertEqual(number("2.9k"), 2900)
        self.assertEqual(number("891.313"), 891313)

    def test_four_scenarios_use_roas_and_impression_growth(self):
        for previous, target, expected in [(180000, 8, 1), (200000, 8, 2),
                                           (180000, 10, 3), (200000, 10, 4)]:
            report = analyze({**BASE, "previous_impressions": previous, "target_roas": target}, TODAY)
            self.assertEqual(report["scenario"], expected)
            self.assertFalse(any("orçamento" in action for action in report["actions"]))

    def test_old_or_incomplete_window_is_not_confirmed(self):
        for changed in [{"last_optimization": "2026-09-25"}, {"period_end": "2026-10-01"},
                        {"period_start": "2026-09-27"}, {"previous_impressions": 0}]:
            report = analyze({**BASE, **changed}, TODAY)
            self.assertIsNone(report["scenario"])

    def test_below_break_even_blocks_lowering_target(self):
        report = analyze({**BASE, "previous_impressions": 200000, "target_roas": 10,
                          "contribution_margin_pct": 10}, TODAY)
        self.assertEqual(report["scenario"], 4)
        self.assertTrue(any("equilíbrio" in text for text in report["warnings"]))
        self.assertFalse(any("teste reduzir" in text.lower() for text in report["actions"]))

    def test_no_spend_is_not_a_scenario(self):
        report = analyze({**BASE, "metrics": {"sales": 0, "spend": 0, "roas": 0}}, TODAY)
        self.assertIsNone(report["scenario"])


if __name__ == "__main__":
    main()
