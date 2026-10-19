/** Action for an existing CRM document. Permissions are supplied and enforced by the server. */
export function orderSapoAction({ order, api, chooseSapo, onSaved, toast }) {
  if (order.sapoOrderUrl) {
    const link = document.createElement('a'); link.className = 'btn ok';
    link.href = order.sapoOrderUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Xem đơn Sapo'; link.title = order.sapoOrderCode || 'Mở đơn trên Sapo';
    return link;
  }
  if (!order.canCreateSapo || order.status === 'cancelled') return null;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary'; button.textContent = 'Tạo đơn Sapo';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await chooseSapo({ orderId: order.id }, { title: 'Tạo đơn Sapo', action: 'Tạo đơn nháp Sapo', existingDocument: true,
        run: (locationId, push) => push ? api('/orders/' + encodeURIComponent(order.id) + '/sapo', 'POST', { sapoLocationId: locationId }) : Promise.resolve({ skipped: true }) });
      if (result) {
        if (result.sapo) toast(result.sapo.status === 'updating' ? (result.sapo.message || 'Đã giao Claw tạo đơn Sapo.') : result.sapo.status === 'existing' ? 'Đã liên kết đơn Sapo có sẵn.' : 'Đã tạo đơn nháp Sapo.');
        await onSaved();
      }
    } catch (e) { toast(e.message, 'err'); }
    finally { button.disabled = false; }
  });
  return button;
}
