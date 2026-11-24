export const MAX_TEMPLATE_BYTES = 3 * 1024 * 1024;
export type ContractDocumentType = "HDKT" | "TAM_UNG" | "BBNT";
export type ContractTemplateBrand = "BN" | "VG";
export type ContractSourceReferences = Partial<
  Record<ContractDocumentType, { revision: number; sourceHash: string }>
>;
