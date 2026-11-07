import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  bigint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { employees } from "../staff/schema.ts";
import { customers } from "../customers/schema.ts";
import { customerActivities } from "../care/schema.ts";
import { enumCheck } from "../../core/db/enum-check.ts";
import { CAMPAIGN_STATUSES } from "./domain/center.ts";

export const customerCampaigns = pgTable(
  "customer_campaigns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES })
      .notNull()
      .default("active"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_customer_campaigns_dates").on(t.status, t.startDate, t.endDate),
    enumCheck("chk_customer_campaigns_status", t.status, CAMPAIGN_STATUSES),
    check(
      "chk_customer_campaigns_input",
      sql`length(btrim(${t.name})) between 1 and 160 and length(${t.note}) <= 2000 and ${t.startDate} <= ${t.endDate} and ${t.revision} > 0`,
    ),
  ],
).enableRLS();

export const customerCampaignTargets = pgTable(
  "customer_campaign_targets",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => customerCampaigns.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => employees.id),
    activityId: text("activity_id").references(() => customerActivities.id, {
      onDelete: "set null",
    }),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_customer_campaign_target").on(t.campaignId, t.customerId),
    uniqueIndex("uq_customer_campaign_activity").on(t.activityId),
    index("idx_customer_campaign_assignee").on(t.assigneeId, t.campaignId),
    check("chk_customer_campaign_target_revision", sql`${t.revision} > 0`),
  ],
).enableRLS();
