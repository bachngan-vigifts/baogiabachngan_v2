import { sql } from "drizzle-orm";
import { AppError } from "../core/errors.ts";
import { json, type Router } from "../core/http/router.ts";
import { cachedReport } from "../core/cache/report-cache.ts";
import type {
  StaffEnv,
  SessionState,
} from "../modules/staff/api/auth-routes.ts";
import { vietnamDate } from "../modules/sales/domain/sales.ts";
import { financeFilters } from "./finance-filters.ts";
import {
  financeCashflow,
  financeReceivables,
  financeBranches,
  assertFinanceBranch,
} from "./finance-readers.ts";
export function registerFinanceRoutes(router: Router<StaffEnv>): void {
  const manager = (state: Record<string, unknown>) => {
    if ((state.session as SessionState).member.role !== "manager")
      throw new AppError(403, "Chỉ Manager xem tổng hợp Tài chính & KPI.");
  };
  router.get(
    "/finance/options",
    async (c) => {
      manager(c.state);
      return json({ branches: await financeBranches(c.env.db) });
    },
    "business",
  );
  router.get(
    "/finance/cashflow",
    async (c) => {
      manager(c.state);
      const f = financeFilters(c.url.searchParams);
      await assertFinanceBranch(c.env.db, f.branch);
      return json(
        await cachedReport(
          c.env.db,
          {
            scope: "finance-cashflow",
            viewer: "manager",
            params: f,
            refresh: c.url.searchParams.get("refresh") === "1",
            ttlMs: 60000,
          },
          () =>
            c.env.db.transaction(async (tx) => {
              await tx.execute(
                sql`set transaction isolation level repeatable read read only`,
              );
              await tx.execute(sql`set local statement_timeout = '6000ms'`);
              return {
                ...f,
                flow: await financeCashflow(tx, f),
                asOf: new Date().toISOString(),
                openingBalance: null,
                closingBalance: null,
              };
            }),
        ),
      );
    },
    "business",
  );
  router.get(
    "/finance/receivables",
    async (c) => {
      manager(c.state);
      const branch = (c.url.searchParams.get("branch") || "").trim();
      if (branch.length > 100)
        throw new AppError(400, "Chi nhánh không hợp lệ.");
      await assertFinanceBranch(c.env.db, branch);
      return json(
        await cachedReport(
          c.env.db,
          {
            scope: "finance-receivables",
            viewer: "manager",
            params: { branch },
            refresh: c.url.searchParams.get("refresh") === "1",
            ttlMs: 60000,
          },
          () =>
            c.env.db.transaction(async (tx) => {
              await tx.execute(
                sql`set transaction isolation level repeatable read read only`,
              );
              await tx.execute(sql`set local statement_timeout = '6000ms'`);
              const today = vietnamDate().iso;
              return {
                branch,
                today,
                asOf: new Date().toISOString(),
                basis: "current" as const,
                totals: await financeReceivables(tx, branch, today),
              };
            }),
        ),
      );
    },
    "business",
  );
}
