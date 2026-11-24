/** Presentation helpers shared by list/editor/import. No inventory writes here. */
export const qty=n=>n===null||n===undefined?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
export const fold=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().trim();
export const columns=[['refNo','Mã kiểm kho'],['createdAt','Thời gian'],['createdByName','Người tạo'],['balancedByName','Người cân bằng'],['valueActual','Tổng thực tế'],['delta','Tổng chênh lệch'],['valueDelta','Tổng giá trị lệch'],['increase','SL lệch tăng'],['valueIncrease','Tổng giá trị tăng'],['decrease','SL lệch giảm'],['valueDecrease','Tổng giá trị giảm'],['balancedAt','Ngày cân bằng'],['actual','SL thực tế'],['note','Ghi chú'],['status','Trạng thái']];
export const defaultColumns=['refNo','createdAt','valueActual','delta','increase','decrease','balancedAt','actual','note','status'];
export const states={draft:'Phiếu tạm',balanced:'Đã cân bằng kho',cancelled:'Đã hủy'};
export const dateGroups=[['Theo ngày',['Hôm nay','Hôm qua']],['Theo tuần',['Tuần này','Tuần trước','7 ngày qua']],['Theo tháng',['Tháng này','Tháng trước','Tháng này (âm lịch)','Tháng trước (âm lịch)','30 ngày qua']],['Theo quý',['Quý này','Quý trước']],['Theo năm',['Năm nay','Năm trước','Năm này (âm lịch)','Năm trước (âm lịch)']]];
const dayMs=864e5,iso=d=>d.toISOString().slice(0,10),date=s=>new Date(s+'T12:00:00Z'),shift=(s,n)=>iso(new Date(+date(s)+n*dayMs));
export const vnToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
// Meeus mean/new-moon and solar-longitude formulae; lunar days are local civil days at UTC+7.
const rad=Math.PI/180,lunation=29.530588853;
function jd(d,m,y){const a=Math.floor((14-m)/12),yy=y+4800-a,mm=m+12*a-3;return d+Math.floor((153*mm+2)/5)+365*yy+Math.floor(yy/4)-Math.floor(yy/100)+Math.floor(yy/400)-32045;}
function moon(k){const t=k/1236.85,t2=t*t,t3=t2*t,m=(359.2242+29.10535608*k-.0000333*t2-.00000347*t3)*rad,p=(306.0253+385.81691806*k+.0107306*t2+.00001236*t3)*rad,f=(21.2964+390.67050646*k-.0016528*t2-.00000239*t3)*rad;
 const base=2415020.75933+29.53058868*k+.0001178*t2-.000000155*t3+.00033*Math.sin((166.56+132.87*t-.009173*t2)*rad);
 const c=(.1734-.000393*t)*Math.sin(m)+.0021*Math.sin(2*m)-.4068*Math.sin(p)+.0161*Math.sin(2*p)-.0004*Math.sin(3*p)+.0104*Math.sin(2*f)-.0051*Math.sin(m+p)-.0074*Math.sin(m-p)+.0004*Math.sin(2*f+m)-.0004*Math.sin(2*f-m)-.0006*Math.sin(2*f+p)+.001*Math.sin(2*f-p)+.0005*Math.sin(2*p+m);
 const dt=t< -11?.001+.000839*t+.0002261*t2-.00000845*t3-.000000081*t*t3:-.000278+.000265*t+.000262*t2;
 return Math.floor(base+c-dt+.5+7/24);
}
function sun(j){const t=(j-.5-7/24-2451545)/36525,m=(357.52910+35999.05030*t-.0001559*t*t-.00000048*t*t*t)*rad,l=(280.46645+36000.76983*t+.0003032*t*t+(1.914600-.004817*t-.000014*t*t)*Math.sin(m)+(.019993-.000101*t)*Math.sin(2*m)+.000290*Math.sin(3*m))*rad;return Math.floor(((l%(2*Math.PI)+2*Math.PI)%(2*Math.PI))/Math.PI*6);}
function month11(y){const k=Math.floor((jd(31,12,y)-2415021.076998695)/lunation),n=moon(k);return sun(n)>=9?moon(k-1):n;}
export function lunarDate(s){const [y,m,d]=s.split('-').map(Number),j=jd(d,m,y),k=Math.floor((j-2415021.076998695)/lunation);let start=moon(k+1);if(start>j)start=moon(k);let a=month11(y),b=a,year;if(a>=start){year=y;a=month11(y-1);}else{year=y+1;b=month11(y+1);}const diff=Math.floor((start-a)/29);let month=diff+11,leap=false;if(b-a>365){const kk=Math.floor((a-2415021.076998695)/lunation+.5);let i=1,last,arc=sun(moon(kk+i));do{last=arc;i++;arc=sun(moon(kk+i));}while(arc!==last&&i<14);const leapAt=i-1;if(diff>=leapAt){month=diff+10;leap=diff===leapAt;}}if(month>12)month-=12;if(month>=11&&diff<4)year--;return {year,month,day:j-start+1,leap};}
export function dateRange(preset,today=vnToday()){
 const now=date(today),y=now.getUTCFullYear(),m=now.getUTCMonth(),first=(yy,mm)=>iso(new Date(Date.UTC(yy,mm,1,12))),last=(yy,mm)=>iso(new Date(Date.UTC(yy,mm+1,0,12)));
 if(preset.includes('âm lịch')){const yearMode=preset.startsWith('Năm'),previous=preset.includes('trước'),part=lunarDate(today),same=(s,p)=>{const n=lunarDate(s);return n.year===p.year&&(yearMode||(n.month===p.month&&n.leap===p.leap));};let from=today;for(let i=0;i<390&&same(shift(from,-1),part);i++)from=shift(from,-1);if(previous){const end=shift(from,-1),prev=lunarDate(end);from=end;for(let i=0;i<390&&same(shift(from,-1),prev);i++)from=shift(from,-1);return {from,to:end};}let to=today;for(let i=0;i<390&&same(shift(to,1),part);i++)to=shift(to,1);return {from,to};}
 if(preset==='Hôm nay')return {from:today,to:today};if(preset==='Hôm qua')return {from:shift(today,-1),to:shift(today,-1)};
 if(preset==='7 ngày qua'||preset==='30 ngày qua')return {from:shift(today,preset==='7 ngày qua'?-6:-29),to:today};
 if(preset.startsWith('Tuần')){const weekday=(now.getUTCDay()+6)%7,from=shift(today,-weekday-(preset==='Tuần trước'?7:0));return {from,to:shift(from,6)};}
 if(preset.startsWith('Quý')){const q=Math.floor(m/3)*3-(preset==='Quý trước'?3:0);return {from:first(y,q),to:last(y,q+2)};}
 if(preset.startsWith('Năm')){const yy=y-(preset==='Năm trước'?1:0);return {from:first(yy,0),to:last(yy,11)};}
 const mm=m-(preset==='Tháng trước'?1:0);return {from:first(y,mm),to:last(y,mm)};
}
export function parseImport(rows){
 if(!Array.isArray(rows)||rows.length<2)throw Error('File chưa có dòng hàng.');const header=rows[0].map(fold),sku=header.findIndex(h=>['ma hang','ma san pham','ma sku','sku'].includes(h)),actual=header.findIndex(h=>['thuc te','so luong thuc te','thuc dem'].includes(h));
 if(sku<0||actual<0)throw Error('File cần cột Mã hàng và Thực tế.');if(header.filter(h=>['ma hang','ma san pham','ma sku','sku'].includes(h)).length!==1||header.filter(h=>['thuc te','so luong thuc te','thuc dem'].includes(h)).length!==1)throw Error('Cột Mã hàng hoặc Thực tế bị lặp, chưa thể xác định dữ liệu cần nhập.');const seen=new Set(),lines=[];
 for(let i=1;i<rows.length;i++){const row=rows[i];if(row.every(v=>v===''||v===null))continue;const code=String(row[sku]??'').trim(),raw=typeof row[actual]==='string'?row[actual].trim():row[actual],value=raw===''||raw===null?null:typeof raw==='number'?raw:Number(String(raw).trim());if(!code||seen.has(code))throw Error(`Dòng ${i+1}: mã trống hoặc trùng ${code}.`);if(value!==null&&(!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*1000-Math.round(value*1000))>.0001))throw Error(`Dòng ${i+1}: Thực tế không hợp lệ (tối đa3số lẻ, số0 hợp lệ).`);seen.add(code);lines.push({sku:code,countedQty:value});}return lines;
}
