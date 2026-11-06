/** Action for an existing CRM document. Permissions are supplied and enforced by the server. */
export function orderSapoAction({ order, api, chooseSapo, onSaved, toast }) {
  if (order.sapoOrderUrl) {
    const link = document.createElement('a'); link.className = 'btn ok';
    link.href = order.sapoOrderUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Xem đơn Sapo'; link.title = order.sapoOrderCode || 'Mở đơn trên Sapo';
    return link;
  }
  if(order.sapoPending){const pending=document.createElement('button');pending.type='button';pending.className='btn secondary';pending.disabled=true;pending.textContent='Đang tạo Sapo';pending.title=order.sapoMessage||'Đang chờ liên kết Sapo, chưa gửi lại để tránh trùng đơn.';return pending;}
  if(order.sapoSourceChanged){const blocked=document.createElement('button');blocked.type='button';blocked.className='btn secondary';blocked.disabled=true;blocked.textContent='Đối soát Sapo';blocked.title='Đơn website đã đổi sau lần gửi Sapo; kiểm tra cùng mã tham chiếu trước khi gửi lại.';return blocked;}
  if (!order.canCreateSapo || order.status === 'cancelled') return null;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary'; button.textContent = order.sapoRetry?'Đối soát / tạo Sapo':'Tạo đơn Sapo';button.title=order.sapoRetry?'Gửi lại cùng mã tham chiếu để Claw đối soát đơn đã có trước khi tạo.':'';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await chooseSapo({ orderId: order.id }, { title: order.sapoRetry?'Đối soát đơn Sapo':'Tạo đơn Sapo', action: order.sapoRetry?'Đối soát / tạo đơn nháp Sapo':'Tạo đơn nháp Sapo', existingDocument: true,
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
