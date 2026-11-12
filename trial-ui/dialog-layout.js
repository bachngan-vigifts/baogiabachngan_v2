// Standard form dialogs share a landscape frame on desktop. Document previews,
// cameras and short confirmations keep their purpose-built layout.
const excluded = '.compact-stock-dialog,.order-compose,.verify-page,.scan-dialog,.stocktake-camera,.stocktake-camera-dialog,.quote-capture-dialog,.order-print-dialog,.contract-docs,#image-dialog,#print-preview,.photo-box';

export function fitDialog(dialog) {
  const drawer = dialog.matches('.sup-drawer');
  if (dialog.matches(excluded) || (drawer ? dialog.hidden : !dialog.open)) return false;
  const form = dialog.querySelector('form');
  // A purchase drawer is reused for detail -> approve -> detail. Drop the old
  // fixed form frame when returning to plain details so the whole drawer scrolls.
  if (drawer && !form) {
    dialog.classList.remove('landscape-dialog','landscape-drawer','landscape-dialog-form');
    return false;
  }
  // POS form dialogs have a title above their form rather than modal-head/body.
  if (dialog.matches('.pos-form-modal') && form && !dialog.querySelector('.landscape-dialog-body')) {
    if (form.querySelectorAll('input:not([type=hidden]),select,textarea').length < 6) return false;
    const title = dialog.querySelector('.pos-modal-content > h2');
    const actions = form.lastElementChild;
    if (!title || !actions?.querySelector('button')) return false;
    const head = document.createElement('header'); head.className = 'modal-head';
    title.before(head); head.append(title, dialog.querySelector('.pos-modal-close'));
    const scroll = document.createElement('div'); scroll.className = 'modal-body';
    for (const child of [...form.children]) if (child !== actions) scroll.append(child);
    form.prepend(scroll); actions.classList.add('modal-foot');
  }
  // Long POS pickers/readers use a plain content shell, without a form. Payment
  // steps, receipts and media retain their dedicated presentation.
  if (dialog.matches('.pos-modal:not(.pos-step-modal):not(.pos-payment-modal):not(.pos-saved-modal)') && !form && !dialog.querySelector('video,canvas,.landscape-dialog-body')) {
    const content = dialog.querySelector('.pos-modal-content'), title = content?.querySelector(':scope > h2'), rect = dialog.getBoundingClientRect();
    if (title && rect.height > 520 && rect.width / rect.height < 1.4) {
      const head = document.createElement('header'); head.className = 'modal-head';
      title.before(head); head.append(title, content.querySelector('.pos-modal-close'));
      const last = content.lastElementChild, footer = last?.matches('.pos-actions,.pos-stock-actions,.pos-customer-actions') ? last : null;
      const scroll = document.createElement('div'); scroll.className = 'modal-body';
      for (const child of [...content.children]) if (child !== head && child !== footer) scroll.append(child);
      head.after(scroll); footer?.classList.add('modal-foot'); dialog.classList.add('pos-readable-modal');
    }
  }
  const head = dialog.querySelector('.modal-head,.cash-dialog-form > header,.sup-drawer-head,.pos-return-head,.pos-flow-head,.acct-detail-head,.task-quick-head');
  let body = dialog.querySelector('.modal-body,.cash-dialog-body,.landscape-dialog-body,.task-quick-body,.approval-debt-card');
  const foot = dialog.querySelector('.modal-foot,.cash-dialog-foot,.sup-drawer-foot,.sup-drawer-foot-sticky,.task-quick-foot');
  const returns = dialog.matches('.pos-return-modal,.pos-flow-modal');
  if (returns && head && !body) body = head.nextElementSibling;
  if (dialog.matches('.acct-drawer') && !body) body = dialog.querySelector('.acct-detail-body');
  if (drawer && form && head && foot && form.contains(foot) && !body) {
    body = document.createElement('div'); body.className = 'landscape-dialog-body';
    for (const child of [...form.children]) if (child !== foot) body.append(child);
    form.prepend(body);
  }
  if ((!head && !dialog.matches('.approval-debt-dialog')) || !body || (!foot && !head?.querySelector('button'))) return false;
  const fields = [...body.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea')];
  const rect = dialog.getBoundingClientRect();
  const tall = rect.height > 520 && rect.width / rect.height < 1.4;
  if (!drawer && !tall && fields.length < 6 && !dialog.matches('.product-admin-dialog,.pr-params,.customer-profile-dialog,.task-quick-dialog')) return false;
  dialog.classList.add('landscape-dialog');
  if (drawer) dialog.classList.add('landscape-drawer');
  const frame = form?.contains(body) ? form : head?.parentElement === body.parentElement ? head.parentElement : dialog;
  frame.classList.add('landscape-dialog-form');
  head?.classList.add('landscape-dialog-head');
  body.classList.add('landscape-dialog-body');
  foot?.classList.add('landscape-dialog-foot');
  if (foot && !body.dataset.landscapeMore) {
    // Báo "còn nội dung bên dưới" bằng bóng ở chân form; chỉ đọc kích thước, không đổi bố cục.
    body.dataset.landscapeMore = '1';
    const sync = () => foot.classList.toggle('landscape-more', body.scrollHeight - body.scrollTop - body.clientHeight > 4);
    body.addEventListener('scroll', sync, { passive: true });
    requestAnimationFrame(sync);
  } else if (foot) requestAnimationFrame(() => foot.classList.toggle('landscape-more', body.scrollHeight - body.scrollTop - body.clientHeight > 4));
  return true;
}

export function installDialogLayouts() {
  const watching = new WeakMap();
  const opened = dialog => {
    if (!(dialog instanceof Element) || !dialog.matches('dialog[open],.sup-drawer:not([hidden])')) return;
    fitDialog(dialog);
    if (watching.has(dialog)) return;
    // Some dialogs load their form after showModal(). Observe only that dialog,
    // and release the observer when it closes; never rescan the whole app on input.
    const observer = new MutationObserver(() => fitDialog(dialog));
    watching.set(dialog, observer);
    const cleanup = () => {
      observer.disconnect();
      watching.delete(dialog);
    };
    if (dialog instanceof HTMLDialogElement) dialog.addEventListener('close', cleanup, { once: true });
    // Non-native supplier/purchase drawers close by toggling hidden.
    observer.observe(dialog, { childList: true, subtree: true, attributes:true, attributeFilter:['hidden'] });
    if (dialog.hidden) cleanup();
  };
  document.querySelectorAll('dialog[open],.sup-drawer:not([hidden])').forEach(opened);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.target.matches('dialog,.sup-drawer')) {
        if (record.target.hidden) { watching.get(record.target)?.disconnect(); watching.delete(record.target); }
        else opened(record.target);
      }
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open','hidden'] });
  return () => observer.disconnect();
}
