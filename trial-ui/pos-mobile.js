import {referenceIcon} from './pos-reference.js';
import {setProductThumbnail} from './product-images.js';

/** Mobile quick-sale presentation; all controls keep their POS handlers. */
export function mountMobileQuick({page,head,left,right,searchBox,nodes,mobileDock}) {
  const doc=page.ownerDocument;
  if(!doc.querySelector('link[data-pos-mobile]')){
    const link=doc.createElement('link');link.rel='stylesheet';link.dataset.posMobile='';link.href=new URL('./pos-mobile.css',import.meta.url).href;doc.head.append(link);
  }
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const button=(label,icon,fn)=>{const n=el('button','pos-mobile-icon');n.type='button';n.setAttribute('aria-label',label);n.title=label;n.append(referenceIcon(doc,icon));n.addEventListener('click',fn);return n;};
  page.classList.add('pos-mobile-quick');
  const title=head.firstElementChild,tools=head.querySelector('.pos-head-tools'),register=title.querySelector('.pos-register-name');
  const menu=el('details','pos-mobile-menu'),summary=el('summary');summary.setAttribute('aria-label','Thao tác bán hàng');summary.append(referenceIcon(doc,'menu'));
  const menuBody=el('div','pos-mobile-menu-body');menuBody.append(title,tools,right.querySelector('.pos-cancel-order'));menu.append(summary,menuBody);
  const toolbar=el('div','pos-mobile-toolbar'),back=title.querySelector('button');
  back.textContent='‹';back.className='pos-mobile-back';back.setAttribute('aria-label','Về CRM');
  toolbar.append(back,el('h1','','Bán nhanh'),button('Chọn sản phẩm','plus',()=>openCatalog(true)),menu);
  searchBox.classList.add('pos-mobile-search');nodes.search.placeholder='Tên, mã hàng, mã vạch';
  searchBox.prepend(referenceIcon(doc,'search'));
  head.replaceChildren(toolbar,...(nodes.invoiceTabs?[nodes.invoiceTabs]:[]),searchBox);

  const context=el('section','pos-mobile-context'),customer=el('div','pos-mobile-customer');
  customer.append(referenceIcon(doc,'search'),nodes.customer);nodes.customer.classList.remove('primary');
  if(nodes.customer.textContent.includes('Chọn khách hàng'))nodes.customer.textContent='Chọn khách hàng';
  const price=nodes.policy.closest('label');price.classList.add('pos-mobile-policy');
  const store=el('div','pos-mobile-store');store.append(el('span','','Quầy bán'),el('strong','',register?.textContent||''));
  context.append(customer,price,store);
  const catalog=el('section','pos-mobile-catalog');catalog.setAttribute('aria-label','Chọn hàng bán');catalog.hidden=true;
  const catalogHead=el('div','pos-mobile-catalog-head');catalogHead.append(el('strong','','Chọn sản phẩm'),button('Đóng danh mục','back',closeCatalog));
  catalog.append(catalogHead,left.querySelector('.pos-catalog-controls'),nodes.grid,left.querySelector('.pos-catalog-pages'));
  const cart=el('section','pos-mobile-cart');cart.setAttribute('aria-label','Sản phẩm trong hóa đơn');cart.append(nodes.lines);
  left.append(context,catalog,cart);

  const details=el('details','pos-mobile-order-details'),detailTitle=el('summary','','Thông tin đơn, phí và giảm giá');
  const layout=right.parentElement;details.append(detailTitle,right);layout.append(details);
  nodes.pay.textContent='Thanh toán';
  const actions=el('div','pos-mobile-footer-actions');nodes.mobileCartOpen.textContent='Thông tin đơn';actions.append(nodes.mobileCartOpen,nodes.pay);mobileDock.append(actions);
  let pickerOpen=false,closedQuery=null;
  function openCatalog(focus=false){pickerOpen=true;closedQuery=null;catalog.hidden=false;if(focus)nodes.search.focus();}
  function closeCatalog(){pickerOpen=false;closedQuery=nodes.search.value.trim();catalog.hidden=true;}
  function syncSearch(){const q=nodes.search.value.trim();if(q&&q!==closedQuery)openCatalog();else if(!pickerOpen)catalog.hidden=true;}
  nodes.search.addEventListener('input',()=>{closedQuery=null;if(nodes.search.value.trim())openCatalog();else closeCatalog();});
  return {syncSearch,closeCatalog,openOrderDetails(){details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'});}};
}

export function decorateMobileQuickLine(row,{unit,imageUrl,name}) {
  const doc=row.ownerDocument,photo=doc.createElement('span');photo.className='pos-mobile-line-photo';
  if(imageUrl&&/^https:\/\//.test(imageUrl)){const image=setProductThumbnail(doc.createElement('img'),imageUrl,'grid');image.alt=name;photo.append(image);}
  else photo.append(referenceIcon(doc,'bag'));
  row.prepend(photo);
  if(unit){const label=doc.createElement('small');label.textContent=' · '+unit;row.querySelector('.pos-line-code').append(label);}
  const edit=row.querySelector('.pos-line-edit'),input=edit.querySelector(':scope>input'),mode=edit.querySelector(':scope>select');
  if(input&&mode){const discount=doc.createElement('label');discount.className='pos-mobile-discount';const label=doc.createElement('span');label.textContent='CK';discount.append(label,input,mode);edit.append(discount);}
}
