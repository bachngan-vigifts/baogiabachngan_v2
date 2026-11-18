/** Match the rendered columns, including permission-dependent tables; never guess by index. */
const normalize=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');
export function labelledCard(roles){
 return cells=>{
  const headers=cells[0]?.closest('table')?.tHead?.rows[0]?.cells||[];
  const labels=cells.map((cell,i)=>[cell.dataset.label,headers[i]?.textContent].map(normalize));
  const layout={};
  for(const [role,aliases]of Object.entries(roles)){
   const index=labels.findIndex(names=>aliases.some(label=>names.includes(normalize(label))));
   if(index>=0)layout[role]=index;
  }
  return layout.title===undefined?null:layout;
 };
}
