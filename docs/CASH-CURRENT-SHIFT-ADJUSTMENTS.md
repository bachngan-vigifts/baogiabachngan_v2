# Correcting the current shift's expected cash

Reproduction: a shift opens with 1 VND entered by mistake, a posted adjustment removes 1 VND, but the closing report still expected 1 VND. cashShiftTotals excluded every adjustment, so the report displayed the correction without including it in expected cash.

- A posted adjustment created in the current shift, with no reconciliation reference or a reference to this shift's reconciliation, contributes to currentAdjustmentNet.
- An adjustment referencing a previous shift's reconciliation remains a correction of the book balance. It is not applied again to the current shift's actual opening cash, which already inherited the previous physical count. Use the reconciliation action when correcting a prior shift.
- Pending and voided entries do not contribute. Corrections remain separate from actual cash income/expenses and do not change sales revenue.

Both shiftReport and reconciliationFor use the corrected expected amount. The closing snapshot and next opening use the corrected closing count through the existing close flow. The original opening figure/audit is retained: 1 opening minus 1 correction equals 0 expected. No stored historical snapshots are rewritten.

The shared close/report view explicitly shows the current correction; K80 and report sections also include it. Prior-shift book corrections carry an explanation that they are not counted again. Legacy snapshots without the new fields retain their old presentation.

No schema/migration, live data rewrite, approval rule, inventory or Sapo changes.

Validation: typecheck and UI build; two regression scenarios cover 1 minus 1 equals 0, replay, void, stored closing report, next opening 0, no false closing reconciliation, a correction linked to this shift's opening discrepancy, and pending/voided exclusions. Existing Cash tests retain the previous-shift correction case (450,000 inherited actual cash stays 450,000 after correcting the prior book discrepancy). Related POS/shared-report/bundle tests are also run. No physical printing or live cash transactions are performed for verification.
