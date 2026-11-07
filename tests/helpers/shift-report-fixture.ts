import { setup } from "./pos-fixture.ts";
import {
  posShifts,
  posShiftTemplates,
} from "../../src/modules/sales/pos-schema.ts";

export async function setupShiftReports() {
  const f = await setup();
  const [template] = await f.db.select().from(posShiftTemplates).limit(1);
  async function closed(
    id: string,
    amount = 1000,
    memberId = "emp",
    difference = 0,
    registerId = f.registerId,
  ) {
    const shift = {
      id,
      cashDrawerId: "store",
      registerId,
      memberId,
      templateId: template!.id,
      businessDate: "2026-11-02",
      openKey: crypto.randomUUID(),
      openedAt: "2026-11-02T01:00:00.000Z",
      closedAt: "2026-11-02T05:00:00.000Z",
      openingCash: 10000,
      expectedCash: 10000 + amount,
      countedCash: 10000 + amount + difference,
      cashDifference: difference,
      differenceReason: difference ? "Chênh lệch kiểm thử" : "",
      note: "",
    };
    const report = {
      shift,
      register: { id: registerId, name: "Quầy Lock" },
      memberName: "Tên " + memberId,
      bills: { count: 1, revenue: amount, discount: 100 },
      cash: amount,
      transfer: 50,
      manual: [
        { direction: "in", kind: "other_income", amount: 20 },
        { direction: "out", kind: "petty_expense", amount: 10 },
      ],
      returns: { credit: 100, refundedCash: 30, refundedTransfer: 20 },
      expectedCash: shift.expectedCash,
      countedCash: shift.countedCash,
      cashDifference: difference,
    };
    await f.db
      .insert(posShifts)
      .values({ ...shift, reportSnapshot: JSON.stringify(report) });
    return report;
  }
  return { ...f, closed };
}
