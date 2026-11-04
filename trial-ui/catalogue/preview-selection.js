export function syncPreviewProducts(list,slide,scroll=false){
 if(!list)return;
 const ids=slide?.type==='products'?slide.items.map(p=>p.id):[],selected=new Set(ids);
 const rows=[...list.querySelectorAll('[data-product-id]')];
 for(const row of rows)row.classList.toggle('current-slide',selected.has(row.dataset.productId));
 const first=rows.find(row=>row.dataset.productId===ids[0]);
 if(scroll&&first)list.scrollTo({top:list.scrollTop+first.getBoundingClientRect().top-list.getBoundingClientRect().top,behavior:'auto'});
}


