/**
 * Đơn hàng và HĐKT là 2 luồng ĐỘC LẬP. HĐKT dùng bản ghi `sales_orders` đi kèm để giữ dòng hàng / giao hàng / công nợ,
 * nhưng người dùng KHÔNG BAO GIỜ thấy số đơn của HĐKT: mọi tên, tiêu đề, link đều theo số HĐKT và trang `#/contracts/<id>`.
 * Hàm thuần: tên + link hiển thị cho một bản ghi (có `contractNo` → HĐKT, không → đơn hàng).
 */
export function docRef(orderId: string, orderNo: string, contractNo?: string | null) {
  return contractNo
    ? { kind: 'contract' as const, no: contractNo, label: `HĐKT ${contractNo}`, Label: `HĐKT ${contractNo}`, link: `#/contracts/${orderId}` }
    : { kind: 'order' as const, no: orderNo, label: `đơn ${orderNo}`, Label: `Đơn ${orderNo}`, link: `#/orders/${orderId}` };
}
