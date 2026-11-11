/** Presentation only. Financial and KPI formulas remain on the server. */
export function financeDefaults(now = new Date()) {
  const day = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  return { from: day.slice(0, 7) + "-01", to: day, branch: "" };
}
export function financeRange(from, to) {
  const valid = (s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  return (
    valid(from) &&
    valid(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 366 * 86400000
  );
}
export function financeMetrics(data, branch = "") {
  const s = data.summary,
    warnings = [];
  if (s.missingOrders || s.unconfirmedOrders)
    warnings.push("Còn đơn thiếu giá vốn hoặc chờ xác nhận giá vốn.");
  if (s.carrierUnknownOrders)
    warnings.push("Còn vận đơn chưa xác định phí hãng vận chuyển.");
  if (
    !data.staff.available ||
    !data.staff.reconciled ||
    (!branch && !data.company?.reconciled)
  )
    warnings.push("Chi phí nhân sự chưa đủ hoặc chưa đối soát khớp.");
  const net = branch
    ? data.branches.find((b) => b.id === branch)?.net
    : data.company?.net;
  if (!Number.isFinite(net))
    warnings.push("Chưa có tổng lợi nhuận cho phạm vi này.");
  const base = s.coveredRevenue + s.feeRevenue,
    ready = !warnings.length;
  return {
    revenue: s.revenue,
    net: ready ? net : null,
    cost: ready ? base - net : null,
    margin: ready && base > 0 ? net / base : null,
    warnings,
    notes: [
      data.staff.partial
        ? "Kỳ có tháng lẻ: chưa trừ chi phí nhân sự của tháng lẻ."
        : "Chi phí nhân sự theo nguồn bảng lương hiện hành; phiếu chưa chốt vẫn là tạm tính.",
      ...(branch
        ? [
            "Chưa phân bổ chi phí chung và lương Sale chưa phân bổ vào từng chi nhánh.",
          ]
        : []),
      ...(!data.officeExpenses.available ? [data.officeExpenses.note] : []),
      ...(!data.cardFees.available ? [data.cardFees.note] : []),
    ],
  };
}
export function financeKpiProgress(part) {
  if (
    part.actual === null ||
    !Number.isFinite(part.actual) ||
    !Number.isFinite(part.target) ||
    part.target <= 0
  )
    return null;
  return (part.actual + part.extra) / part.target;
}
