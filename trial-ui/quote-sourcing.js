const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const num=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const select=(items,label)=>{const s=el('select');s.setAttribute('aria-label',label);for(const [value,name] of items){const o=el('option','',name);o.value=value;s.append(o);}return s;};
const qty=(value,label)=>{const n=el('input');n.type='number';n.min='0';n.step='0.001';n.value=value;n.setAttribute('aria-label',label);return n;};
const button=(text,fn)=>{const b=el('button','btn secondary small',text);b.type='button';b.addEventListener('click',fn);return b;};
/** A separate choice keeps deferring purchasing distinct from cancelling document creation. */
export function chooseSourcePurchase({count,skuCount,quoteNo,canPurchase}) {
  return new Promise(resolve=>{
    const dialog=el('dialog','modal purchase-source-choice');
    dialog.setAttribute('aria-label','Tạo đơn mua NCC cùng đơn bán');
    const head=el('div','modal-head');head.append(el('h2','','Tạo đơn mua NCC ngay?'));
    const body=el('div','modal-body');body.append(
      el('p','',`${quoteNo}: ${skuCount} mã cần đặt từ ${count} NCC.`),
      el('p','muted','Tạo ngay: gộp theo NCC thành đơn mua nháp, cần duyệt riêng. Đơn mua đã tạo vẫn được giữ nếu bước sinh đơn bán/HĐKT sau đó bị dừng.'),
      el('p','muted','Đặt NCC sau: tiếp tục sinh đơn bán/HĐKT và lưu kế hoạch nguồn hàng, chưa tạo đơn mua.'));
    if(!canPurchase)body.append(el('p','muted','Bạn chưa có quyền lập đơn mua NCC. Có thể tiếp tục và nhờ người có quyền đặt sau.'));
    const foot=el('div','modal-foot');
    const back=button('Quay lại rà nguồn',()=>finish(null));
    const later=button('Đặt NCC sau · Tiếp tục',()=>finish('later'));
    const now=button('Tạo đơn mua nháp ngay',()=>finish('create'));now.className='btn primary';now.disabled=!canPurchase;
    foot.append(back,later,now);dialog.append(head,body,foot);
    function finish(value){dialog.close();dialog.remove();resolve(value);}
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
    document.body.append(dialog);dialog.showModal();later.focus();
  });
}
/** Source allocations become packing drafts; request buttons explicitly save related purchasing/transfer requests. */
export async function initQuoteSourcing({api,host,quoteId,confirmBox,choosePurchase=chooseSourcePurchase,isCurrent=()=>true}) {
  host.replaceChildren(el('p','muted','Đang lấy kho và nguồn hàng…'));
  const data=await api('/quotes/'+encodeURIComponent(quoteId)+'/stock-plan');
  if(!isCurrent())return null;
  const selling=data.warehouses.filter(w=>w.canSell);
  const warehouse=select([['','Chọn kho bán / kho xuất'],...selling.map(w=>[w.id,w.name+(w.opened?'':' · Chưa chốt đầu kỳ')])],'Kho bán / kho xuất');
  if(selling.length===1)warehouse.value=selling[0].id;
  const heading=el('h3','','Lấy hàng từ đâu?'),label=el('label','','Kho bán / kho xuất');label.append(warehouse);
  const hint=el('p','muted small','Duyệt đơn trước, xuất từng phần theo nguồn. Chỉ xác nhận xuất khi hàng đã có tại kho bán và kho đã chốt đầu kỳ. Khi sinh đơn/HĐKT: phần xin hàng từ kho khác tự lập phiếu điều chuyển chờ duyệt; phần đặt NCC bạn chọn tạo đơn mua nháp ngay hoặc đặt sau. Các nút tạo riêng vẫn lưu yêu cầu ngay, kể cả khi đóng hộp này.');
  const summary=el('p','quote-source-summary',`${data.lines.length} mã sản phẩm · Rà số lượng và nguồn cho từng mã`);
  const toolbar=el('div','quote-source-toolbar');toolbar.append(heading,summary,label,hint);
  const list=el('div','quote-source-list'),error=el('p','error');error.setAttribute('role','alert');host.replaceChildren(toolbar,list,error);
  let busy=false,suppliers=null;const cards=[];
  const requireWarehouse=()=>{if(!warehouse.value)throw Error('Chọn kho bán / kho xuất trước.');return data.warehouses.find(w=>w.id===warehouse.value);};
  const markBusy=value=>{busy=value;warehouse.disabled=value||cards.some(c=>c.sources.some(s=>s.saved||s.uncertain));for(const c of cards){c.from.disabled=value;for(const s of c.sources){for(const i of [s.type,s.location,s.supplier,s.amount,s.remove])i.disabled=value||!!s.saved||!!s.uncertain;s.action.disabled=value||!!s.saved||!!s.uncertain||(s.type.value==='incoming'&&!data.canRequestEarly)||(s.type.value==='purchase'&&!data.canPurchase);}}};
  function source(card,initial) {
    const row=el('div','quote-source-row'),type=select([['transfer','Xin hàng từ kho khác'],['purchase','Đặt hàng NCC'],['incoming','Hàng đang chờ về · Xin giao trước']],'Nguồn hàng '+card.line.sku);
    const location=select([['','Chọn kho xin hàng'],...data.warehouses.filter(w=>w.id!==warehouse.value).map(w=>[w.id,w.name])],'Kho xin hàng '+card.line.sku);
    const supplier=select([['','Chọn NCC'],...(suppliers||[]).map(p=>[p.id,p.name])],'Nhà cung cấp '+card.line.sku);supplier.hidden=true;
    const amount=qty(initial,'Số lượng nguồn hàng '+card.line.sku),result=el('div','small');result.setAttribute('role','status');
    const action=button('Xin hàng',()=>save()),remove=button('×',()=>{if(!busy&&!entry.saved&&!entry.uncertain){card.sources.splice(card.sources.indexOf(entry),1);row.remove();}});
    remove.setAttribute('aria-label','Bỏ nguồn hàng '+card.line.sku);
    const entry={type,location,supplier,amount,result,action,row,remove,saved:null};card.sources.push(entry);
    async function sync(){location.hidden=type.value!=='transfer';supplier.hidden=type.value!=='purchase';
      action.textContent=type.value==='transfer'?'Xin hàng':type.value==='purchase'?'Lập đơn mua nháp':'Xin giao trước';
      action.disabled=busy||!!entry.saved||!!entry.uncertain||(type.value==='incoming'&&!data.canRequestEarly)||(type.value==='purchase'&&!data.canPurchase);
      if(type.value==='purchase'&&suppliers===null){try{suppliers=(await api('/purchase-options')).suppliers;for(const c of cards)for(const s of c.sources){const chosen=s.supplier.value;s.supplier.replaceChildren(...[['','Chọn NCC'],...suppliers.map(p=>[p.id,p.name])].map(([v,t])=>{const o=el('option','',t);o.value=v;return o;}));s.supplier.value=chosen;}}catch(e){suppliers=null;error.textContent=e.message;}}
    }
    type.addEventListener('change',sync);
    async function save(){if(busy||entry.saved||entry.uncertain||!isCurrent())return;error.textContent='';
      try {
        const destination=requireWarehouse(),quantity=Number(amount.value),fromStock=Number(card.from.value),other=card.sources.filter(s=>s!==entry).reduce((n,s)=>n+Number(s.amount.value),0);
        if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(other)||!Number.isFinite(fromStock)||fromStock<0||quantity+other+fromStock>card.line.qty+0.0005)throw Error('Số lượng nguồn hàng không hợp lệ hoặc vượt số lượng báo giá.');
        if(type.value==='transfer'&&(!location.value||location.value===destination.id))throw Error('Chọn kho xin hàng khác kho bán.');
        if(type.value==='purchase'&&!supplier.value)throw Error('Chọn nhà cung cấp để lập đơn mua nháp.');
        if(type.value==='incoming'&&(!Number.isSafeInteger(quantity)||quantity>card.line.incoming))throw Error('Số lượng xin lấy trước phải nguyên dương và không vượt tổng hàng đang về.');
        if(!await confirmBox(`Lưu ${action.textContent.toLowerCase()} cho ${data.quoteNo}: ${card.line.sku} · ${num(quantity)} ${card.line.unit}?`,{title:action.textContent,ok:'Lưu yêu cầu'}))return;
        markBusy(true);let response,href,text;
        if(type.value==='transfer') {response=await api('/stock-transfers','POST',{fromWarehouseId:location.value,toWarehouseId:destination.id,reason:`Báo giá ${data.quoteNo} · ${data.customerName}`.slice(0,500),lines:[{sku:card.line.sku,qty:quantity}]});href='#/transfers/'+encodeURIComponent(response.id);text='Phiếu xin hàng · Chờ duyệt';}
        else if(type.value==='purchase') {response=await api('/purchase-orders','POST',{orders:[{supplierId:supplier.value,warehouse:destination.name,note:'Nguồn hàng cho báo giá '+data.quoteNo,lines:[{sku:card.line.sku,name:card.line.name,unit:card.line.unit,quantity,sources:[{type:'quote',id:quoteId,quantity}]}]}]});href='#/purchases/'+encodeURIComponent(response.ids[0]);text='Đơn mua NCC · Nháp';}
        else {entry.key ||= crypto.randomUUID();response=await api('/purchase-early-requests','POST',{clientKey:entry.key,lines:[{sku:card.line.sku,quantity}],scope:{status:'all'}});href='#/purchases?mode=incoming&request='+encodeURIComponent(response.request.id);text='Phiếu xin lấy trước · Nháp';}
        entry.saved={quantity,type:type.value,from:type.value==='transfer'?location.selectedOptions[0]?.textContent:type.value==='purchase'?supplier.selectedOptions[0]?.textContent:'Hàng đang chờ về',href,text};
        for(const input of[type,location,supplier,amount,remove])input.disabled=true;warehouse.disabled=true;
        const link=el('a','',text);link.href=href;link.target='_blank';link.rel='noopener';result.replaceChildren(link);
      }catch(e){error.textContent=e.message;if(busy&&(!e.status||e.status>=500)){entry.uncertain=true;error.textContent+=' Chưa xác định yêu cầu đã lưu hay chưa. Kiểm tra danh sách điều chuyển / đơn mua / xin lấy trước theo báo giá trước khi tạo thêm.';}}finally{markBusy(false);await sync();}
    }
    row.append(type,location,supplier,amount,action,remove,result);card.sourcesHost.append(row);sync();return entry;
  }
  function draw(){list.replaceChildren();cards.length=0;for(const [index,line] of data.lines.entries()){
    const box=el('div','pack-line'),head=el('div','pack-head');head.append(el('b','',`${index+1}. ${line.name}`),el('small','',`${line.sku} · ${num(line.qty)} ${line.unit}`));
    const grid=el('div','pack-grid'),need=el('label','','Cần lấy'),total=qty(line.qty,'Cần lấy '+line.sku);total.readOnly=true;need.append(total);
    const available=el('label','','Tồn kho bán'),stock=el('span','pack-av');available.append(stock);
    const take=el('label','','Lấy từ kho'),from=qty(0,'Lấy từ kho '+line.sku);take.append(from);grid.append(need,available,take);
    const sourcesHost=el('div'),card={line,from,stock,sourcesHost,sources:[]};cards.push(card);
    const allocation=el('div','quote-source-allocation'),stockBlock=el('div','quote-source-stock'),requests=el('div','quote-source-requests');
    stockBlock.append(grid);
    if(line.incoming>0)stockBlock.append(el('p','pack-incoming-hint',`Có hàng đang chờ về: ${num(line.incoming)} ${line.unit}`));
    requests.append(sourcesHost,button('＋ Thêm nguồn hàng',()=>{if(busy)return;source(card,Math.max(0,line.qty-Number(from.value)-card.sources.reduce((n,s)=>n+Number(s.amount.value),0)));}));
    allocation.append(stockBlock,requests);box.append(head,allocation);list.append(box);
    const amount=warehouse.value?Math.max(0,Number(line.stock[warehouse.value]||0)):0;stock.textContent=warehouse.value?num(amount):'Chọn kho';from.value=Math.min(line.qty,amount);
    if(Number(from.value)<line.qty)source(card,line.qty-Number(from.value));
  }}
  warehouse.addEventListener('change',()=>{error.textContent='';draw();});draw();
  /** Xin hàng từ kho khác chưa bấm "Xin hàng": khi sinh đơn tự lập phiếu điều chuyển (gộp theo kho xin), không để kế hoạch chỉ nằm trên giấy. */
  async function createPendingTransfers(){
    const pending=cards.flatMap(card=>card.sources.filter(entry=>entry.type.value==='transfer'&&!entry.saved&&!entry.uncertain&&Number(entry.amount.value)>0).map(entry=>({card,entry,quantity:Number(entry.amount.value)})));
    if(!pending.length)return;
    const destination=requireWarehouse(),groups=new Map();
    for(const item of pending){const id=item.entry.location.value;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(item);}
    markBusy(true);
    try{
      for(const [from,items] of groups){
        const lines=new Map();for(const {card,quantity} of items)lines.set(card.line.sku,(lines.get(card.line.sku)||0)+quantity);
        let response;
        try{response=await api('/stock-transfers','POST',{fromWarehouseId:from,toWarehouseId:destination.id,reason:`Báo giá ${data.quoteNo} · ${data.customerName}`.slice(0,500),lines:[...lines].map(([sku,qty])=>({sku,qty}))});}
        catch(e){if(!e.status||e.status>=500){for(const {entry} of items)entry.uncertain=true;error.textContent='Chưa xác định phiếu xin hàng đã lưu hay chưa. Kiểm tra danh sách Điều chuyển kho theo báo giá trước khi tạo thêm.';throw Error(error.textContent);}throw e;}
        const href='#/transfers/'+encodeURIComponent(response.id);
        for(const {entry,quantity} of items){entry.saved={quantity,type:'transfer',from:entry.location.selectedOptions[0]?.textContent,href,text:'Phiếu xin hàng · Chờ duyệt'};const link=el('a','',entry.saved.text);link.href=href;link.target='_blank';link.rel='noopener';entry.result.replaceChildren(link);}
      }
    }finally{markBusy(false);}
    if(!isCurrent())throw Error('Form đã đóng. Các phiếu xin hàng đã lập được giữ trong Điều chuyển kho.');
  }
  const planner={read(){if(!cards.length)return {};if(busy)throw Error('Đang lưu yêu cầu nguồn hàng, vui lòng chờ.');const w=requireWarehouse();
    const stockPlan=[];
    const plan=[`KẾ HOẠCH NGUỒN HÀNG · ${data.quoteNo}`,`Kho bán: ${w.name}`];
    for(const c of cards){const take=Number(c.from.value),amounts=c.sources.map(s=>Number(s.amount.value));
      if(!Number.isFinite(take)||take<0||amounts.some(q=>!Number.isFinite(q)||q<0)||Math.abs(take+amounts.reduce((a,b)=>a+b,0)-c.line.qty)>0.0005)throw Error(`${c.line.sku}: tổng lấy từ kho và nguồn khác phải bằng ${num(c.line.qty)}.`);
      if(take>Math.max(0,Number(c.line.stock[w.id]||0))+0.0005)throw Error(`${c.line.sku}: phần lấy từ kho vượt tồn; chọn nguồn cho phần thiếu.`);
      if(take>0)stockPlan.push({sku:c.line.sku,qty:take,type:'stock',note:w.name});
      plan.push(`${c.line.sku}: lấy từ ${w.name} ${num(take)} ${c.line.unit}`);
      for(const s of c.sources)if(Number(s.amount.value)>0){
        if(s.uncertain)throw Error(`${c.line.sku}: chưa xác định yêu cầu đã lưu hay chưa. Kiểm tra danh sách theo báo giá trước khi tiếp tục.`);
        if(s.type.value==='transfer'&&!s.location.value)throw Error(`${c.line.sku}: chọn kho xin hàng.`);
        if(s.type.value==='purchase'&&!s.supplier.value)throw Error(`${c.line.sku}: chọn NCC.`);
        const origin=s.saved?.from||(s.type.value==='transfer'?s.location.selectedOptions[0]?.textContent:s.type.value==='purchase'?s.supplier.selectedOptions[0]?.textContent:'Hàng đang chờ về');
        const note=`${origin}${s.saved?' · '+s.saved.href:' · Chưa tạo yêu cầu'}`;
        stockPlan.push({sku:c.line.sku,qty:Number(s.amount.value),type:s.type.value,note});
        plan.push(`  ${s.saved?.text||s.type.selectedOptions[0].textContent}: ${num(Number(s.amount.value))} ${c.line.unit} · ${note}`);
      }
    }
    return {warehouseId:w.id,stockPlan,note:plan.join('\n')};
  },async prepare(){
    if(!isCurrent())throw Error('Form đã đóng. Mở lại trước khi sinh đơn.');
    planner.read(); // Validate every allocation before creating any request.
    await createPendingTransfers();
    const pending=cards.flatMap(card=>card.sources.filter(entry=>entry.type.value==='purchase'&&!entry.saved&&Number(entry.amount.value)>0).map(entry=>({card,entry,quantity:Number(entry.amount.value)})));
    if(!pending.length)return planner.read();
    const destination=requireWarehouse(),groups=new Map();
    for(const item of pending){const id=item.entry.supplier.value;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(item);}
    const choice=await choosePurchase({count:groups.size,skuCount:new Set(pending.map(p=>p.card.line.sku)).size,quoteNo:data.quoteNo,canPurchase:data.canPurchase});
    if(!isCurrent())throw Error('Form đã đóng. Mở lại trước khi sinh đơn.');
    if(choice==='later')return planner.read();
    if(choice!=='create')throw Error('Đã quay lại rà nguồn hàng. Chưa sinh đơn/HĐKT.');
    if(!data.canPurchase)throw Error('Bạn không có quyền lập đơn mua NCC.');
    const batches=[...groups.values()];
    const orders=batches.map(items=>{
      const lines=new Map();
      for(const {card,quantity} of items){const sku=card.line.sku;const line=lines.get(sku)||{sku,name:card.line.name,unit:card.line.unit,quantity:0,sources:[{type:'quote',id:quoteId,quantity:0}]};line.quantity+=quantity;line.sources[0].quantity+=quantity;lines.set(sku,line);}
      return {supplierId:items[0].entry.supplier.value,warehouse:destination.name,note:'Nguồn hàng cho báo giá '+data.quoteNo,lines:[...lines.values()]};
    });
    markBusy(true);
    try{
      const response=await api('/purchase-orders','POST',{orders});
      if(!Array.isArray(response.ids)||response.ids.length!==batches.length||response.ids.some(id=>typeof id!=='string'||!id))throw Error('Máy chủ chưa trả đủ mã đơn mua.');
      batches.forEach((items,i)=>{const href='#/purchases/'+encodeURIComponent(response.ids[i]);for(const {entry,quantity} of items){entry.saved={quantity,type:'purchase',from:entry.supplier.selectedOptions[0]?.textContent,href,text:'Đơn mua NCC · Nháp'};const link=el('a','',entry.saved.text);link.href=href;link.target='_blank';link.rel='noopener';entry.result.replaceChildren(link);}});
    }catch(e){if(!e.status||e.status>=500){for(const {entry} of pending)entry.uncertain=true;error.textContent='Chưa xác định đơn mua đã lưu hay chưa. Kiểm tra danh sách theo báo giá trước khi tạo thêm.';throw Error(error.textContent);}throw e;}
    finally{markBusy(false);}
    if(!isCurrent())throw Error('Form đã đóng. Các đơn mua đã lập được giữ trong danh sách Đơn mua NCC.');
    return planner.read();
  }};
  return planner;
}
