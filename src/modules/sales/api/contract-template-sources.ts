import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import {
  json,
  readJson,
  type Router,
  type RouteContext,
} from "../../../core/http/router.ts";
import { auditLogs } from "../../../core/db/schema.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import type {
  ContractDocumentType,
  ContractTemplateBrand,
  ContractSourceReferences,
} from "../../../core/contracts/contract-template-source.ts";
import { contractTemplateSources as sources } from "../contract-source-schema.ts";
import { salesContracts, salesOrders } from "../schema.ts";
import {
  validateTemplateSource,
  MAX_TEMPLATE_BYTES,
} from "../domain/contract-source-file.ts";
import manifest from "../domain/contract-source-manifest.json" with { type: "json" };

type Ctx = RouteContext<StaffEnv>;
type Db =
  | StaffEnv["db"]
  | Parameters<Parameters<StaffEnv["db"]["transaction"]>[0]>[0];
const mime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const manager = (c: Ctx) => {
  const me = viewer(c);
  if (me.role !== "manager")
    throw new AppError(403, "Chỉ Manager được quản lý file mẫu chung.");
  return me;
};
const keys = (c: Ctx) => {
  const brand = c.params.brand,
    documentType = c.params.type;
  if (
    !["BN", "VG"].includes(brand || "") ||
    !["HDKT", "TAM_UNG", "BBNT"].includes(documentType || "")
  )
    throw new AppError(400, "Loại file mẫu không hợp lệ.");
  return {
    brand: brand as ContractTemplateBrand,
    documentType: documentType as ContractDocumentType,
  };
};
const latest = async (db: Db, brand: string, type: string) =>
  (
    await db
      .select()
      .from(sources)
      .where(and(eq(sources.brand, brand), eq(sources.documentType, type)))
      .orderBy(desc(sources.revision))
      .limit(1)
  )[0];
export async function contractSourceSnapshot(
  db: Db,
  brand: ContractTemplateBrand,
): Promise<ContractSourceReferences> {
  const rows = await db
    .selectDistinctOn([sources.documentType])
    .from(sources)
    .where(eq(sources.brand, brand))
    .orderBy(asc(sources.documentType), desc(sources.revision));
  return Object.fromEntries(
    rows.map((r) => [
      r.documentType,
      { revision: r.revision, sourceHash: r.sourceHash },
    ]),
  );
}
async function signed(c: Ctx, row: typeof sources.$inferSelect) {
  if (!c.env.files) throw new AppError(503, "Chưa bật kho lưu file mẫu.");
  const url = (await c.env.files.signedUrls([row.fileKey], 300)).get(
    row.fileKey,
  );
  if (!url)
    throw new AppError(
      409,
      "File mẫu của phiên bản này không còn trong kho. Liên hệ Manager; CRM không tự đổi sang mẫu khác.",
    );
  return {
    revision: row.revision,
    sourceHash: row.sourceHash,
    fileName: row.fileName,
    url,
  };
}
export function registerContractSourceRoutes(
  router: Router<StaffEnv>,
  loadOrder: (
    c: Ctx,
    id: string,
    db?: Db,
  ) => Promise<typeof salesOrders.$inferSelect>,
) {
  router.get(
    "/contract-template-sources/:brand/:type",
    async (c) => {
      manager(c);
      const { brand, documentType } = keys(c),
        row = await latest(c.env.db, brand, documentType),
        base = manifest[brand][documentType];
      return json({
        brand,
        documentType,
        revision: row?.revision ?? 0,
        sourceHash: row?.sourceHash ?? base.sourceHash,
        defaultPath: base.path,
        requiredFields: base.fields,
        requiresGoodsTable: base.goodsTable,
        source: row ? await signed(c, row) : null,
      });
    },
    "business",
  );
  router.post(
    "/contract-template-sources/:brand/:type",
    async (c) => {
      const me = manager(c),
        { brand, documentType } = keys(c),
        base = manifest[brand][documentType],
        body = await readJson(c.req, 4500000);
      if (!c.env.files) throw new AppError(503, "Chưa bật kho lưu file mẫu.");
      if (
        !Number.isSafeInteger(body.revision) ||
        Number(body.revision) < 0 ||
        typeof body.clientKey !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.clientKey)
      )
        throw new AppError(400, "Thiếu phiên bản hoặc mã thao tác file mẫu.");
      if (
        typeof body.fileName !== "string" ||
        body.fileName.length > 160 ||
        !/^([^/\\\u0000-\u001f]+)\.docx$/i.test(body.fileName)
      )
        throw new AppError(
          400,
          "Chỉ nhận file Word .docx, tên tối đa 160 ký tự.",
        );
      if (
        typeof body.base64 !== "string" ||
        body.base64.length > Math.ceil(MAX_TEMPLATE_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)
      )
        throw new AppError(
          400,
          "Nội dung file mẫu không hợp lệ hoặc vượt 3 MB.",
        );
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0));
        validateTemplateSource(bytes, base.fields, base.goodsTable);
      } catch (error) {
        throw new AppError(
          400,
          error instanceof Error ? error.message : "File mẫu không hợp lệ.",
        );
      }
      const sourceHash = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const replay = async (db: Db) => {
        const [r] = await db
          .select()
          .from(sources)
          .where(
            and(
              eq(sources.createdBy, me.id),
              eq(sources.clientKey, body.clientKey as string),
            ),
          )
          .limit(1);
        if (
          r &&
          (r.brand !== brand ||
            r.documentType !== documentType ||
            r.sourceHash !== sourceHash ||
          r.fileName !== body.fileName ||
            r.revision !== Number(body.revision) + 1)
        )
          throw new AppError(409, "Mã thao tác đã dùng cho file mẫu khác.");
        return r;
      };
      const old = await replay(c.env.db);
      if (old)
        return json({
          revision: old.revision,
          sourceHash: old.sourceHash,
          replayed: true,
        });
      const fileKey = `contract-templates/${brand}/${documentType}/${crypto.randomUUID()}.docx`,
        files = c.env.files;
      try {
        await files.put(fileKey, bytes, mime);
      } catch (error) {
        await files.remove([fileKey]).catch(() => {});
        throw error;
      }
      try {
        const result = await c.env.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`contract-source:${brand}:${documentType}`}))`,
          );
          const existing = await replay(tx);
          if (existing) return existing;
          const current = await latest(tx, brand, documentType);
          if ((current?.revision ?? 0) !== body.revision)
            throw new AppError(
              409,
              "Manager khác đã đổi mẫu. Mở lại mẫu trước khi tải lên.",
            );
          const row = {
            brand,
            documentType,
            revision: Number(body.revision) + 1,
            fileKey,
            fileName: body.fileName as string,
            sourceHash,
            clientKey: body.clientKey as string,
            createdBy: me.id,
            createdAt: new Date().toISOString(),
          };
          await tx.insert(sources).values(row);
          await tx
            .insert(auditLogs)
            .values({
              id: crypto.randomUUID(),
              actorId: me.id,
              module: "sales",
              action: "template-source-upload",
              entityType: "contract-template",
              entityId: brand + ":" + documentType,
              data: JSON.stringify({
                revision: row.revision,
                sourceHash,
                fileName: row.fileName,
              }),
              createdAt: row.createdAt,
            });
          return row;
        });
        if (result.fileKey !== fileKey)
          await files.remove([fileKey]).catch(() => {});
        return json({
          revision: result.revision,
          sourceHash: result.sourceHash,
        });
      } catch (error) {
        // On a lost commit acknowledgement, never delete a file already referenced by a revision.
        let committed = true;
        try {
          committed = !!(
            await c.env.db
              .select({ key: sources.fileKey })
              .from(sources)
              .where(eq(sources.fileKey, fileKey))
              .limit(1)
          )[0];
        } catch {
          /* uncertain: retain the private file */
        }
        if (!committed) await files.remove([fileKey]).catch(() => {});
        throw error;
      }
    },
    "business",
  );
  router.get(
    "/contracts/:id/template-sources",
    async (c) => {
      const [k] = await c.env.db
        .select()
        .from(salesContracts)
        .where(eq(salesContracts.id, c.params.id!))
        .limit(1);
      if (!k) throw new AppError(404, "Không tìm thấy HĐKT.");
      await loadOrder(c, k.orderId);
      const data = JSON.parse(k.data),
        references = data.templateSnapshot?.sources as
          | ContractSourceReferences
          | undefined,
        out: Record<string, unknown> = {};
      for (const type of ["HDKT", "TAM_UNG", "BBNT"] as const) {
        const ref = references?.[type];
        if (!ref) continue;
        const [r] = await c.env.db
          .select()
          .from(sources)
          .where(
            and(
              eq(sources.brand, k.legalEntity === "VG" ? "VG" : "BN"),
              eq(sources.documentType, type),
              eq(sources.revision, ref.revision),
            ),
          )
          .limit(1);
        if (!r || r.sourceHash !== ref.sourceHash)
          throw new AppError(
            409,
            "Không tìm thấy đúng phiên bản file mẫu của hồ sơ. Liên hệ Manager.",
          );
        out[type] = await signed(c, r);
      }
      return json({ sources: out });
    },
    "business",
  );
}
