import { initAdjustmentQueue, openCountHistory, printCountSheet } from './inventory-adjustments.js';
import { startBarcodeCamera } from './barcode-camera.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const number=n=>n===null||n===undefined?'—':Number(n).toLocaleString('vi-VN',{maximumFractionDigits:3});

export function initStocktake({api,root,toast,confirmBox,userId,ensureCatalog,findProducts}){
 let owner='',config=null,lines=[],warehouseId='',pending=null,busy=false,stockRun=0,searchRun=0,sendRun=0,timer=0,stockTimer=0,editing=false;
 const lineLimit=()=>config?.stocktakeLimit||300;
 const rowViews=new Map(),childClosers=new Set();let sheetRun=0,leaveTask=null,draftSaved=true;
 const page=el('div','sup-page'),head=el('div','page-head'),titles=el('div');
 const description=el('p','muted');titles.append(el('span','eyebrow','Kho hàng'),el('h1','','Kiểm kê hàng'),description);
 const actions=el('div','head-actions row-gap');
 const create=button('',()=>newSheet(),'btn-add');create.title='Tạo phiếu kiểm kê mới';create.setAttribute('aria-label','Tạo phiếu kiểm kê mới');
 create.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
 const resume=button('Tiếp tục phiếu đang nhập',()=>showEditor());resume.hidden=true;actions.append(resume,create);head.append(titles,actions);
 const dialog=el('dialog','modal stocktake-dialog');dialog.setAttribute('aria-label','Phiếu kiểm kê mới');
 const panel=el('section','panel stocktake-panel'),controls=el('fieldset','stocktake-controls');
 const warehouse=el('select');warehouse.setAttribute('aria-label','Kho kiểm kê');
 const search=el('input');search.type='search';search.placeholder='Nhập tên, mã SKU, barcode';search.autocomplete='off';search.setAttribute('aria-label','Tìm sản phẩm kiểm kê');
 const reason=el('input');reason.placeholder='Lý do / ghi chú kiểm kê';reason.maxLength=500;reason.setAttribute('aria-label','Lý do kiểm kê');
 const results=el('div','stocktake-results'),hint=el('p','small muted'),feedback=el('p','error');feedback.setAttribute('role','alert');
 const draftInfo=el('p','small muted','Xem nhanh phiếu khác không làm mất số thực đếm đang nhập.');
 // Quét mã vạch: mỗi lần quét cộng 1 vào thực đếm (mã chưa có trong phiếu thì tự thêm).
 // Ô TÌM / QUÉT gộp một (kiểu ô tìm của app bán hàng): kính lúp · ô nhập · nút mã vạch mở camera.
 // Quét bằng máy cầm tay hoặc gõ đúng mã SKU / barcode rồi Enter: +1 vào thực đếm (mã chưa có thì tự thêm), ô tự xoá để quét tiếp.
 // Gõ tên rồi chọn trong danh sách: chỉ thêm dòng, chưa đếm.
 const tools=el('div','stocktake-tools'),scanInfo=el('p','small muted stocktake-scan-info');scanInfo.setAttribute('role','status');
 // Điện thoại: nút mở camera quét liên tục (mã vạch / QR), mỗi mã đọc được +1 như máy quét cầm tay.
 const camBtn=button('Quét mã bằng camera',()=>openCamera(),'scan-field-btn');camBtn.dataset.mobileInline='';camBtn.title='Quét mã bằng camera';
 const searchField=el('div','scan-field stocktake-search');searchField.append(search,camBtn);
 // Tạo nhanh: thêm cả loạt mã theo thương hiệu / mã còn tồn / mã lệch Sapo nhiều nhất.
 const quickMode=el('select'),brandSel=el('select');quickMode.setAttribute('aria-label','Tạo nhanh danh sách mã');brandSel.setAttribute('aria-label','Thương hiệu');brandSel.hidden=true;
 for(const [v,t] of [['','Tạo nhanh danh sách mã…'],['brand','Theo thương hiệu'],['instock','Mọi mã còn tồn trong kho'],['sapo','50 mã lệch Sapo nhiều nhất']])quickMode.append(Object.assign(el('option','',t),{value:v}));
 const quickBtn=button('Thêm vào phiếu',()=>quickAdd());
 const printBtn=button('In phiếu đếm',()=>printCountSheet({title:'PHIẾU ĐẾM KIỂM KÊ',warehouse:config?.warehouses?.find(w=>w.id===warehouseId)?.name||'',reason:reason.value.trim(),lines:lines.map(l=>({sku:l.sku,name:l.name,unit:l.unit,expected:l.expectedQty,counted:l.countedQty}))}));
 tools.append(quickMode,brandSel,quickBtn,printBtn);
 const wrap=el('div','table-wrap'),table=el('table','data-table'),thead=el('thead'),hr=el('tr'),tbody=el('tbody');
 const columns=()=>['Sản phẩm','ĐVT','Tồn lúc đếm','Thực đếm','Chênh lệch',...(config?.warehouses||[]).map(w=>'Tồn '+w.name),'Phiếu chờ duyệt','Thao tác'];
 function renderHeaders(){hr.replaceChildren(...columns().map(label=>el('th','',label)));}renderHeaders();
 thead.append(hr);table.append(thead,tbody);wrap.append(table);
 const summary=el('p','stocktake-summary');summary.setAttribute('role','status');
 const back=button('‹ Danh sách phiếu',()=>beforeLeave());
 const formHead=el('div','card-title-row');formHead.append(el('h2','card-title','Phiếu kiểm kê mới'),back);
 const clear=button('Bỏ bản nháp',async()=>{const id=owner,run=sheetRun;if(!busy&&!pending&&await confirmBox('Bỏ các dòng kiểm kê chưa gửi?',{title:'Bỏ bản nháp',ok:'Bỏ bản nháp',danger:true,delay:3000})){if(id!==userId()||run!==sheetRun||busy||pending)return;stockRun++;lines=[];reason.value='';save();render();}});
 const send=button('Gửi Manager duyệt',()=>submit(),'btn primary');
 controls.append(warehouse,reason,searchField,scanInfo,results,hint,tools,clear,wrap);
 panel.append(formHead,controls,summary,feedback,draftInfo,send);
 const history=el('section','panel inv-adjustments-panel');dialog.append(panel);page.append(head,dialog,history);root.append(page);
 dialog.addEventListener('cancel',e=>{e.preventDefault();beforeLeave();});
 const queue=initAdjustmentQueue({api,host:history,toast,kind:'stocktake',userId,onChanged:async()=>{await queue.load(config);if(editing)await refreshStock();}});
 updatePage();
 function updatePage(){panel.hidden=!editing;history.hidden=false;description.textContent=editing?'Nhập số thực đếm; tồn và phiếu kiểm kê chờ duyệt tự cập nhật. Chỉ Manager được duyệt hoàn thành.':'Quản lý phiếu kiểm kê theo kho. Bấm + để tạo phiếu mới; chỉ Manager được duyệt hoàn thành.';resume.hidden=editing||(!lines.length&&!pending&&!warehouseId&&!reason.value.trim());create.disabled=!config?.canManage||busy||!!pending;}
 function showEditor(){editing=true;updatePage();if(!dialog.open)dialog.showModal();if(lines.length&&!pending)refreshStock();(warehouseId?search:warehouse).focus();}
 function hasDraft(){return editing&&owner===userId()&&!!(warehouseId||reason.value.trim()||lines.length||pending);}
 function close(){save();sheetRun++;stockRun++;searchRun++;clearTimeout(timer);clearTimeout(stockTimer);for(const closeChild of [...childClosers])closeChild();childClosers.clear();editing=false;if(dialog.open)dialog.close();updatePage();}
 function beforeLeave(){if(leaveTask)return leaveTask;const id=owner,run=sheetRun;leaveTask=(async()=>{if(busy){toast('Đang gửi phiếu; chờ kết quả trước khi rời trang.','err');return false;}if(hasDraft()&&!await confirmBox(draftSaved?'Phiếu kiểm kê chưa gửi. Rời phiếu? Bản nháp được giữ trên thiết bị để tiếp tục sau.':'Không lưu được bản nháp trên thiết bị. Rời phiếu sẽ mất nội dung đang nhập.',{title:'Rời phiếu kiểm kê?',ok:'Rời phiếu',danger:true,delay:3000}))return false;if(id!==userId()||run!==sheetRun)return false;close();return true;})().finally(()=>{leaveTask=null;});return leaveTask;}
 async function newSheet(){
  if(busy||pending||!config?.canManage)return;const id=owner,run=sheetRun;
  if((lines.length||warehouseId||reason.value.trim())&&!await confirmBox('Tạo phiếu mới sẽ bỏ nội dung phiếu chưa gửi hiện tại. Tiếp tục?',{title:'Tạo phiếu kiểm kê mới',ok:'Tạo phiếu mới',danger:true,delay:3000}))return;
  if(id!==userId()||run!==sheetRun||busy||pending)return;
  sheetRun++;stockRun++;searchRun++;clearTimeout(stockTimer);lines=[];warehouseId='';warehouse.value='';reason.value='';feedback.textContent='';hint.textContent='';scanInfo.textContent='';results.replaceChildren();save();render();showEditor();
 }
 async function openLedger(line){
  const id=owner,run=sheetRun,wh=warehouseId;
  try{const {openStocktakeLedger}=await import('./stocktake-ledger.js');if(id!==userId()||run!==sheetRun||!editing)return;
   const closeChild=openStocktakeLedger({api,sku:line.sku,name:line.name,warehouseId:wh,warehouses:config?.warehouses||[],isCurrent:()=>id===userId()&&run===sheetRun&&editing,onClose:()=>childClosers.delete(closeChild)});childClosers.add(closeChild);
  }catch(e){if(id===userId()&&run===sheetRun)toast(e.message,'err');}
 }
 function pendingCell(line,cell){
  cell.replaceChildren();
  if(!Array.isArray(line.pendingRefs)){cell.textContent='Đang kiểm tra…';return;}
  if(!line.pendingRefs.length){cell.textContent='—';return;}
  for(const ref of line.pendingRefs){const link=button(ref.refNo,()=>queue.open(ref.id),'link-btn');link.title=(ref.createdByName||'')+' · '+new Date(ref.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});cell.append(link);}
 }
 function updateLine(line){const view=rowViews.get(line.sku);if(!view)return;view.baseline.textContent=line.stockChanged?`${number(line.expectedQty)} → ${number(line.latestStock)} · tồn đổi sau lúc đếm`:number(line.expectedQty);view.baseline.classList.toggle('warn-text',!!line.stockChanged);view.count.disabled=line.expectedQty===null;view.delta.textContent=line.countedQty===null||line.expectedQty===null?'—':number(line.countedQty-line.expectedQty);pendingCell(line,view.pending);for(const [id,cell]of view.stocks||[])cell.textContent=number(line.warehouseStock?.[id]);}
 const key=()=>`bn-stocktake-draft:${owner}`;
 function save(){if(!owner||owner!==userId())return;try{localStorage.setItem(key(),JSON.stringify({warehouseId,reason:reason.value,lines:lines.map(({warehouseStock,...line})=>line),pending}));draftSaved=true;draftInfo.textContent='Xem nhanh phiếu khác không làm mất số thực đếm đang nhập.';}catch{draftSaved=false;draftInfo.textContent='Không lưu được nháp trên thiết bị; giữ trang này mở đến khi gửi thành công.';}}
 function totals(){const counted=lines.filter(l=>l.countedQty!==null).length;const diff=lines.filter(l=>l.countedQty!==null&&l.expectedQty!==null&&Math.abs(l.countedQty-l.expectedQty)>0.000001).length;summary.textContent=`${lines.length}/${lineLimit()} sản phẩm · Đã đếm ${counted} · ${diff} mã lệch`+(lines.length>lineLimit()?' · Bớt dòng vượt giới hạn trước khi gửi':'');send.disabled=busy||!config?.canManage||!lines.length||lines.length>lineLimit()||(!pending&&lines.some(l=>!Array.isArray(l.pendingRefs)||l.pendingRefs.length));printBtn.disabled=!lines.length;}
 function freeze(){controls.disabled=busy||!!pending;search.disabled=camBtn.disabled=!warehouseId||busy||!!pending;send.textContent=busy?'Đang gửi phiếu…':pending?'Kiểm tra lại lần gửi':'Gửi Manager duyệt';send.classList.toggle('is-busy',busy);totals();updatePage();}
 function render(){
  renderHeaders();tbody.replaceChildren();rowViews.clear();
  for(const line of lines){
   const tr=el('tr'),name=el('td','first'),skuLink=button(line.sku,()=>openCountHistory({api,toast,sku:line.sku,warehouseId,onOpen:id=>queue.open(id)}),'link-btn');skuLink.title='Lịch sử kiểm kê mã này';
   const skuLine=el('small');skuLine.append(skuLink);name.append(el('b','',line.name),skuLine);
   const count=el('input');count.type='number';count.min='0';count.step='0.001';count.placeholder='Chưa đếm';count.value=line.countedQty===null?'':String(line.countedQty);count.disabled=line.expectedQty===null;count.setAttribute('aria-label','Thực đếm '+line.sku);
   const delta=el('td','num');delta.dataset.label='Chênh lệch';const update=()=>{delta.textContent=line.countedQty===null||line.expectedQty===null?'—':number(line.countedQty-line.expectedQty);};update();
   count.addEventListener('input',()=>{if(line.stockChanged&&Number.isFinite(line.latestStock)){line.expectedQty=line.latestStock;line.stockChanged=false;updateLine(line);}const v=count.value===''?null:Number(count.value);line.countedQty=v;update();totals();save();});
   const countCell=el('td');countCell.dataset.label='Thực đếm';countCell.append(count);
   const remove=el('td');remove.dataset.label='Thao tác';remove.append(button('Sổ kho',()=>openLedger(line),'btn secondary small'),button('Bỏ',()=>{if(busy||pending)return;lines=lines.filter(l=>l!==line);stockRun++;save();render();clearTimeout(stockTimer);if(lines.length)stockTimer=setTimeout(()=>refreshStock(),250);},'btn ghost small'));
   const unit=el('td','',line.unit||'—'),baseline=el('td','num',number(line.expectedQty));unit.dataset.label='ĐVT';baseline.dataset.label='Tồn lúc đếm';
   const pendingBox=el('td','stocktake-pending');pendingBox.dataset.label='Phiếu kiểm kê chờ duyệt';
   const stocks=new Map();for(const wh of config?.warehouses||[]){const cell=el('td','num stocktake-wh-stock');cell.dataset.label='Tồn '+wh.name;cell.title=wh.openedAt?'Tồn sổ kho hiện tại':'Kho chưa chốt tồn đầu kỳ';stocks.set(wh.id,cell);}
   tr.append(name,unit,baseline,countCell,delta,...stocks.values(),pendingBox,remove);tbody.append(tr);rowViews.set(line.sku,{row:tr,baseline,delta,count,pending:pendingBox,stocks});pendingCell(line,pendingBox);updateLine(line);
  }
  totals();freeze();
 }
 async function refreshStock({retry=true}={}){
  if(busy||pending||!warehouseId||!lines.length||!editing)return;
  const run=++stockRun,id=owner,wh=warehouseId,skus=lines.map(l=>l.sku);feedback.textContent='';
  try{
   const data=await api('/inventory/count-stock','POST',{warehouseId:wh,skus,includeWarehouses:true});if(run!==stockRun||id!==userId()||wh!==warehouseId)return;
   if(!data.pendingBySku)throw Error('Chưa tải được thông tin phiếu kiểm kê chờ duyệt.');
   for(const line of lines)if(Object.hasOwn(data.stock,line.sku)){line.warehouseStock=data.warehouseStock?.[line.sku]||{};line.latestStock=data.stock[line.sku];if(line.countedQty===null||line.expectedQty===null)line.expectedQty=line.latestStock;line.stockChanged=Math.abs(line.expectedQty-line.latestStock)>0.000001;line.pendingRefs=data.pendingBySku[line.sku]||[];updateLine(line);}
   hint.textContent='Tồn tự cập nhật '+new Date(data.observedAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+'. Mã có phiếu chờ duyệt cần đối chiếu trước khi gửi.';
   save();totals();
  }catch(e){if(run===stockRun&&id===userId()){feedback.textContent=e.message;if(retry){clearTimeout(stockTimer);stockTimer=setTimeout(()=>refreshStock({retry:false}),800);}}}
 }
 function add(product,{focus=true}={}){
  if(busy||pending||!warehouseId||!editing)return;
  if(lines.some(l=>l.sku===product.sku)){toast('Mã này đã có trong phiếu.');return;}
  if(lines.length>=lineLimit()){toast(`Mỗi phiếu tối đa ${lineLimit()} mã.`,'err');return;}
  const v=product.stock?.[warehouseId];lines.push({sku:product.sku,name:product.name,unit:product.unit||'',barcodes:product.barcodes||[],expectedQty:typeof v==='number'?v:null,countedQty:null,pendingRefs:null});stockRun++;
  if(focus){search.value='';results.replaceChildren();searchRun++;}save();render();if(focus)search.focus();
  clearTimeout(stockTimer);stockTimer=setTimeout(()=>refreshStock(),250);
 }
 async function find(localResult){
  const q=search.value.trim(),run=++searchRun,id=owner,wh=warehouseId;results.replaceChildren();if(!q||!warehouseId||!editing)return;
  let found=localResult===undefined?findProducts(q):localResult;
  if(!found){hint.textContent='Đang tìm sản phẩm…';try{found=(await api('/products?limit=20&q='+encodeURIComponent(q))).products;}catch(e){if(run===searchRun)hint.textContent=e.message;return;}}
  if(run!==searchRun||id!==userId()||wh!==warehouseId||!editing||busy||pending)return;
  for(const product of found.slice(0,20))results.append(button(`${product.name} · ${product.sku} · ${product.unit||''}`,()=>add(product),'transfer-search-result'));
  hint.textContent=found.length?'Bấm sản phẩm để thêm; số 0 thực đếm phải nhập rõ.':'Không tìm thấy sản phẩm.';
 }
 const sameCode=(p,code)=>String(p.sku).toLowerCase()===code.toLowerCase()||(p.barcodes||[]).includes(code);
 let scanQueue=Promise.resolve();
 /** Mã đúng SKU / barcode → +1 (thêm dòng nếu chưa có), trả true. Không khớp mã nào → false (`quiet`: không báo, để Enter chuyển sang tìm theo tên). */
 async function scanCode(code,{quiet=false}={}){
  if(!code||busy||pending||!editing)return false;const scanOwner=owner,scanWh=warehouseId,scanSheet=sheetRun;
  if(!warehouseId){feedback.textContent='Chọn kho trước khi quét mã.';return false;}
  let line=lines.find(l=>sameCode(l,code));
  if(!line){
   let product=(findProducts(code)||[]).find(p=>sameCode(p,code));
   if(!product){try{product=(await api('/products?limit=5&q='+encodeURIComponent(code))).products.find(p=>sameCode(p,code));}catch(e){feedback.textContent=e.message;return false;}}
   if(scanOwner!==userId()||scanWh!==warehouseId||scanSheet!==sheetRun||!editing)return false;
   if(!product){if(!quiet){scanInfo.textContent='Không tìm thấy mã '+code;scanInfo.className='small error stocktake-scan-info';}return false;}
   if(!lines.some(l=>l.sku===product.sku))add(product,{focus:false});
   line=lines.find(l=>l.sku===product.sku);if(!line)return false;
  }
  if(line.stockChanged&&Number.isFinite(line.latestStock)&&line.countedQty===null){line.expectedQty=line.latestStock;line.stockChanged=false;}
  line.countedQty=Math.round(((line.countedQty||0)+1)*1000)/1000;
  const view=rowViews.get(line.sku);if(view){view.count.value=String(line.countedQty);updateLine(line);view.row.classList.remove('stocktake-scanned');void view.row.offsetWidth;view.row.classList.add('stocktake-scanned');view.row.scrollIntoView?.({block:'nearest'});}
  scanInfo.className='small muted stocktake-scan-info';scanInfo.textContent=`${line.sku} · ${line.name}: đếm ${number(line.countedQty)}`;totals();save();
  return true;
 }
 const cameraError=e=>e?.name==='NotAllowedError'?'Chưa được cấp quyền camera. Bật quyền Camera cho trang CRM trong cài đặt trình duyệt rồi thử lại.'
  :e?.name==='NotFoundError'?'Không tìm thấy camera trên thiết bị này.'
  :e?.name==='NotReadableError'?'Camera đang được ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.':(e?.message||'Không mở được camera.');
 /** Quét liên tục: đọc được mã → +1 (cùng hàng đợi với máy quét cầm tay), nghỉ 1,2 giây để không đếm trùng một lần đưa mã, rồi quét tiếp. */
 function openCamera(){
  if(busy||pending)return;
  if(!warehouseId){feedback.textContent='Chọn kho trước khi quét mã.';return;}
  const dlg=el('dialog','modal stocktake-camera'),head=el('div','modal-head'),body=el('div','modal-body'),video=el('video','stocktake-video');
  const last=el('p','stocktake-camera-last','Đưa mã vạch / QR vào giữa khung.'),hint=el('p','small muted','Mỗi lần đọc được mã là +1 vào thực đếm. Chờ báo số mới rồi đưa mã tiếp; bấm Xong khi đếm xong.');
  let closed=false,handle=null,read=0;const cameraSheet=sheetRun;const controller=new AbortController();
  const close=()=>{if(dlg.open)dlg.close();};
  childClosers.add(close);
  head.append(el('h2','','Quét mã bằng camera'),button('Xong',close,'btn primary'));
  body.append(video,last,hint);dlg.append(head,body);document.body.append(dlg);
  globalThis.addEventListener?.('hashchange',close);
  dlg.addEventListener('close',()=>{childClosers.delete(close);closed=true;controller.abort();handle?.stop();globalThis.removeEventListener?.('hashchange',close);dlg.remove();if(read)toast(`Đã quét ${read} lần bằng camera.`);},{once:true});
  dlg.showModal();
  // Quét liên tục trên MỘT luồng camera (chỉ xin quyền một lần mỗi lần mở); đóng rồi mở lại trong 30 giây dùng lại luồng cũ.
  const start=async()=>{
   if(closed)return;
   try{
    handle=await startBarcodeCamera(video,code=>{
     if(closed)return;read++;globalThis.navigator?.vibrate?.(60);last.textContent='Đang ghi '+code+'…';
     scanQueue=scanQueue.then(()=>!closed&&cameraSheet===sheetRun?scanCode(code):false).catch(()=>{}).then(()=>{if(!closed)last.textContent=scanInfo.textContent||code;});
    },{signal:controller.signal,continuous:true,pauseMs:1200,keepWarmMs:30000});
    if(closed)handle.stop();
   }catch(e){if(closed)return;video.hidden=true;last.textContent=cameraError(e);hint.textContent='Có thể gõ mã hoặc dùng máy quét cầm tay ở ô "Quét mã vạch".';}
  };
  start();
 }

 let brandsLoaded=false;
 quickMode.addEventListener('change',async()=>{brandSel.hidden=quickMode.value!=='brand';if(quickMode.value!=='brand'||brandsLoaded)return;
  try{const data=await api('/product-brands');brandSel.replaceChildren(Object.assign(el('option','','Chọn thương hiệu'),{value:''}),...data.brands.filter(b=>b.name).map(b=>Object.assign(el('option','',`${b.name} (${b.count})`),{value:b.name})));brandsLoaded=true;}catch(e){feedback.textContent=e.message;}});
 async function quickAdd(){
  const mode=quickMode.value;if(!mode||busy||pending)return;
  if(lines.length>=lineLimit()){toast(`Mỗi phiếu tối đa ${lineLimit()} mã.`,'err');return;}
  if(!warehouseId){feedback.textContent='Chọn kho trước khi tạo nhanh.';return;}
  if(mode==='brand'&&!brandSel.value){feedback.textContent='Chọn thương hiệu.';return;}
  const wh=warehouseId,id=owner,sheet=sheetRun,run=++stockRun;quickBtn.disabled=true;feedback.textContent='';
  try{
   const data=await api('/inventory/count-candidates','POST',{warehouseId:wh,mode,brand:brandSel.value,limit:50});if(id!==userId()||sheet!==sheetRun||wh!==warehouseId||!editing||busy||pending)return;
   const have=new Set(lines.map(l=>l.sku)),fresh=data.items.filter(i=>!have.has(i.sku)),take=fresh.slice(0,Math.max(0,lineLimit()-lines.length));
   if(!fresh.length){toast(data.items.length?'Các mã này đã có trong phiếu.':'Không có mã nào phù hợp.');return;}
   if(take.length>200&&!await confirmBox(`Thêm ${take.length} mã vào phiếu kiểm kê?`,{title:'Tạo nhanh phiếu kiểm kê',ok:'Thêm mã'}))return;
   for(const i of take)lines.push({sku:i.sku,name:i.name,unit:i.unit,barcodes:[],expectedQty:i.stock,latestStock:i.stock,countedQty:null,pendingRefs:data.pendingBySku?.[i.sku]||[]});
   if(run===stockRun)stockRun++;save();render();clearTimeout(stockTimer);stockTimer=setTimeout(()=>refreshStock(),250);
   toast(`Đã thêm ${take.length} mã vào phiếu`+(take.length<fresh.length||data.truncated?` (tối đa ${lineLimit()} mã mỗi phiếu)`:'')+'.');
  }catch(e){feedback.textContent=e.message;}
  finally{quickBtn.disabled=busy||!!pending;}
 }
 search.addEventListener('input',()=>{clearTimeout(timer);searchRun++;const q=search.value.trim();if(!q){results.replaceChildren();return;}const local=findProducts(q);if(local)find(local);else timer=setTimeout(()=>find(),180);});
 // Enter (máy quét cầm tay gửi mã + Enter): đúng mã → +1 và xoá ô để quét tiếp; không phải mã → hiện kết quả tìm theo tên.
 search.addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;event.preventDefault();
  const code=search.value.trim();if(!code)return;
  clearTimeout(timer);searchRun++;search.value='';results.replaceChildren();
  const queuedSheet=sheetRun;return scanQueue=scanQueue.then(async()=>{if(queuedSheet!==sheetRun)return;const ok=await scanCode(code,{quiet:true});if(!ok&&!search.value){search.value=code;await find();}}).catch(()=>{});
 });
 reason.addEventListener('input',save);
 warehouse.addEventListener('change',async()=>{const next=warehouse.value,id=owner,run=sheetRun;const yes=!lines.length||await confirmBox('Đổi kho sẽ bỏ các dòng kiểm kê hiện tại. Tiếp tục?',{title:'Đổi kho kiểm kê',ok:'Đổi kho',danger:true,delay:3000});if(id!==userId()||run!==sheetRun||busy||pending)return;if(!yes){warehouse.value=warehouseId;return;}sheetRun++;stockRun++;searchRun++;warehouseId=next;lines=[];results.replaceChildren();save();render();});
 globalThis.addEventListener?.('online',()=>{if(editing)refreshStock();});
 globalThis.addEventListener?.('focus',()=>{if(editing)refreshStock();});
 async function submit(){
  if(busy||!config?.canManage||owner!==userId())return;const submittingOwner=owner,submittingSheet=sheetRun;
  if(!pending){
   if(!warehouseId||!lines.length||reason.value.trim().length<3){feedback.textContent='Chọn kho, thêm sản phẩm và nhập lý do (ít nhất 3 ký tự).';return;}
   if(lines.some(l=>!Array.isArray(l.pendingRefs)||l.pendingRefs.length)){feedback.textContent='Có mã chưa kiểm tra được phiếu chờ duyệt hoặc đang có phiếu kiểm kê khác. Mở phiếu để đối chiếu hoặc bỏ mã trùng.';return;}
   if(lines.some(l=>l.countedQty===null||!Number.isFinite(l.countedQty)||l.countedQty<0||l.expectedQty===null)){feedback.textContent='Nhập số thực đếm cho mọi dòng (kể cả 0) và chờ hệ thống lấy đủ tồn đối chiếu.';return;}
   // Tồn đổi sau lúc đếm: gửi theo chênh lệch (thực đếm − tồn lúc đếm), Manager duyệt sẽ áp vào tồn hiện tại.
   const changed=lines.filter(l=>l.stockChanged);
   if(changed.length&&!await confirmBox(`Tồn đã thay đổi sau lúc đếm ở ${changed.length} mã (${changed.slice(0,3).map(l=>l.sku).join(', ')}${changed.length>3?'…':''}). Gửi theo chênh lệch: khi duyệt, tồn mới = tồn hiện tại + (thực đếm − tồn lúc đếm). Nếu đếm sau khi tồn đổi, hãy nhập lại số đếm thay vì gửi.`,{title:'Gửi theo chênh lệch',ok:'Gửi theo chênh lệch'}))return;
   if(busy||pending||submittingOwner!==userId()||submittingSheet!==sheetRun)return;
   pending={source:'stocktake',clientKey:crypto.randomUUID(),warehouseId,reason:reason.value.trim(),lines:lines.map(({sku,expectedQty,countedQty})=>({sku,expectedQty,countedQty})),...(changed.length?{applyDelta:true}:{})};save();
  }
  const id=owner,run=++sendRun;busy=true;feedback.textContent='';freeze();
  try{const result=await api('/inventory/adjustments','POST',pending);if(id!==userId())return;pending=null;lines=[];reason.value='';warehouseId='';warehouse.value='';close();save();render();toast('Đã gửi phiếu '+result.refNo+' chờ Manager duyệt.');await queue.load(config);}
  catch(e){if(id!==userId())return;const unknown=!e.status||e.status>=500;if(!unknown)pending=null;feedback.textContent=e.message+(unknown?' Chưa rõ kết quả; bấm kiểm tra lại lần gửi, không lập phiếu khác.':'');save();if(e.code==='STOCKTAKE_PENDING'||e.code==='STOCKTAKE_STOCK_CHANGED')setTimeout(()=>refreshStock(),0);}
  finally{if(run===sendRun){busy=false;if(id===userId())freeze();}}
 }
 async function load(){
  const id=userId();if(!id)return;
  if(owner!==id){close();owner=id;stockRun++;searchRun++;sendRun++;busy=false;config=null;pending=null;editing=false;lines=[];warehouseId='';reason.value='';try{const draft=JSON.parse(localStorage.getItem(key())||'null');if(draft&&Array.isArray(draft.lines)&&draft.lines.length<=1000){lines=draft.lines.map(l=>({...l,pendingRefs:null,warehouseStock:{}}));warehouseId=draft.warehouseId||'';reason.value=draft.reason||'';pending=draft.pending||null;}}catch{}render();}
  try{const next=await api('/inventory/status');if(id!==userId())return;config=next;const placeholder=el('option','','Chọn kho kiểm kê');placeholder.value='';warehouse.replaceChildren(placeholder);
   for(const wh of config.warehouses){const option=el('option','',wh.name+(wh.openedAt?'':' · Chưa chốt đầu kỳ'));option.value=wh.id;option.disabled=!wh.openedAt;warehouse.append(option);}
   warehouse.value=warehouseId;if(warehouseId&&!config.warehouses.some(w=>w.id===warehouseId&&w.openedAt))feedback.textContent='Kho của bản nháp không còn sẵn sàng kiểm kê. Chọn lại kho trước khi gửi.';if(!config.canManage)feedback.textContent='Bạn có quyền xem; cần quyền lập đề nghị điều chỉnh để gửi kiểm kê.';render();if(editing&&lines.length&&!pending)refreshStock();await queue.load(config);
  }catch(e){feedback.textContent=e.message;}
  ensureCatalog().catch(()=>{});
 }
 return {load,close,hasDraft,beforeLeave};
}
