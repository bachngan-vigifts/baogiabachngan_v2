# Illustrated payroll setup guide

All names, amounts, employees and screenshots are synthetic local fixtures. No production payroll records, bank accounts or credentials are exported.

Recreate screenshots / browser checks:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/payroll-guide.mjs
```

Build PDF and editable Word (Python packages `reportlab`, `python-docx`, `Pillow`, and DejaVu fonts):

```bash
python3 scripts/build-payroll-guide.py
```

Artifacts in `trial-ui/guides/`: 11-page PDF, Word guide, ten actual UI screenshots. The payroll screen links the PDF. `results.json` records the canonical-net/KPI check (95 million recognized revenue, 91.5% KPI) Sale-only filtering/empty lists, annual target registration/year-switch checks, and JavaScript error list.

The guide covers shared settings, Sale, Sale Admin, store managers, store salespeople, policy switches, data sources and closing the previous month on days 03–05. It clearly describes the manual inputs and unsupported automations. Do not replace these fixtures with private production screenshots.
