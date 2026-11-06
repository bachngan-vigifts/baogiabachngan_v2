/** Read-only score presentation shared by dashboard and individual payroll. All source values use textContent. */
export const scoreNumber=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('vi-VN',{maximumFractionDigits:2}):'—';
export const reportScoreText=v=>v?.basis?`${scoreNumber(v.basis.points)} / ${scoreNumber(v.basis.required)} điểm`:'Chưa có bản lưu điểm';
export function reportWeekLabel(w){
 if(w.review==='excused')return 'Miễn';
 if(w.review==='rejected')return 'Chưa đạt';
 if(w.state==='exempt')return 'Miễn trước triển khai';
 const state={on_time:'Đúng hạn',late:'Nộp trễ',missing:'Chưa nộp',not_due:'Chưa tới hạn'}[w.state]||'Chưa xác định';
 return w.review==='pending'?'Chờ duyệt · '+state:w.review==='ok'?'Đạt · '+state:state;
}
export function createReportScoreCard(view){
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const root=node('section',null,'report-score-card');root.dataset.reportScores='';
 const title=node('div',null,'report-score-heading'),month=/^\d{4}-\d{2}$/.test(view?.month||'')?view.month.split('-').reverse().join('/'):'—';
 title.append(node('h3','Điểm báo cáo tháng '+month),node('strong',reportScoreText(view),'report-score-total'));root.append(title);
 root.append(node('p',view?.source==='snapshot'?'Theo bản lưu lúc chốt lương.':view?.source==='live'?'Tạm tính theo báo cáo và kết quả duyệt hiện tại.':'Phiếu đã chốt chưa có bản lưu điểm báo cáo; không thay bằng điểm hiện tại.','muted small'));
 if(view?.applied===false&&view?.basis)root.append(node('p','Điểm theo dõi báo cáo; phiếu này không dùng điểm để tính tiền trách nhiệm.','muted small'));
 const b=view?.basis;
 if(b){
  const table=node('table',null,'report-score-table'),head=node('thead'),tr=node('tr'),body=node('tbody');
  for(const label of ['Tuần / hạn nộp','Trạng thái','Điểm'])tr.append(node('th',label));head.append(tr);table.append(head,body);
  const day=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?iso.slice(0,10).split('-').reverse().join('/'):'—';
  b.weeks.forEach((w,i)=>{const row=node('tr'),week=node('td');week.append(node('b',`Tuần ${i+1} · ${day(w.period)}`),node('small','Hạn: '+(Number.isNaN(Date.parse(w.deadline))?'—':new Date(w.deadline).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}))));row.append(week,node('td',reportWeekLabel(w)),node('td',scoreNumber(w.score),'num'));body.append(row);});root.append(table);
  const pending=b.weeks.filter(w=>w.score===null).length;
  root.append(node('p',`Tổng tháng lấy ${b.required} tuần có điểm cao nhất, tối đa ${b.required} điểm. Tuần xếp vào tháng theo hạn nộp.${pending?' Còn '+pending+' tuần chưa tới hạn.':''}`,'muted small'));
 }
 const link=node('a','Xem báo cáo tuần','btn ghost small');link.href='#/weekly-reports?month='+encodeURIComponent(view?.month||'');root.append(link);return root;
}
