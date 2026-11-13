import { AppError } from "../../../core/errors.ts";
/** Explicit server configuration only. No client-selected URL, model, key or prompt. */
export interface AccountingAiConfig {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}
export async function accountingAssistant(
  config: AccountingAiConfig | undefined,
  facts: {
    code: string;
    value: number | null;
    kState: string;
    coverage: boolean;
  },
) {
  if (!config?.apiKey || !config.model)
    throw new AppError(
      503,
      "Trợ lý AI chưa được cấu hình nhà cung cấp. Các cảnh báo hiện tại được tính bằng quy tắc, không phải AI.",
    );
  const allowed = [
    "negative_stock",
    "tax_unknown",
    "opening_missing",
    "slow_stock",
    "high_stock",
    "import_imbalance",
    "cost_unknown",
    "below_cost",
    "k_reference",
  ];
  if (
    !allowed.includes(facts.code) ||
    (facts.value !== null && !Number.isFinite(facts.value))
  )
    throw new AppError(400, "Dữ kiện cảnh báo không hợp lệ.");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await (config.fetch || fetch)(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: "Bearer " + config.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          max_completion_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Bạn hỗ trợ kế toán Việt Nam. Chỉ giải thích dữ kiện số được cung cấp, không coi tham số K nội bộ là kết luận thuế. Không đoán pháp luật/thuế suất, không đề xuất đổi SKU, hóa đơn khống, xuất hóa đơn khi chưa bán, sửa sổ hoặc phát hành. Thiếu chứng từ thì yêu cầu đối soát. Trả JSON {"summary":string,"checks":string[]} tiếng Việt, tối đa 3 bước kiểm tra chứng từ. Không có công cụ thực hiện giao dịch.',
            },
            { role: "user", content: JSON.stringify(facts) },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error("provider");
    const text = await response.text();
    if (text.length > 20000) throw new Error("size");
    const result = JSON.parse(
      JSON.parse(text).choices?.[0]?.message?.content || "null",
    );
    if (
      !result ||
      typeof result.summary !== "string" ||
      result.summary.length > 2000 ||
      !Array.isArray(result.checks) ||
      result.checks.length > 3 ||
      result.checks.some(
        (s: unknown) => typeof s !== "string" || s.length > 800,
      )
    )
      throw new Error("format");
    return {
      summary: result.summary,
      checks: result.checks as string[],
      advisoryOnly: true,
      canIssue: false,
      requiresHumanReview: true,
    };
  } catch {
    throw new AppError(
      502,
      "Trợ lý chưa trả lời được. Dùng bảng cảnh báo và đối soát chứng từ; chưa có thay đổi dữ liệu.",
    );
  } finally {
    clearTimeout(timer);
  }
}
