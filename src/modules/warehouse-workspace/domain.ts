/** Warehouse work is measured in scheduled minutes in Asia/Ho_Chi_Minh, never browser time. */
export interface Calendar { days:number[]; start:string; end:string; breakStart:string; breakEnd:string }
export interface Wait { id:string; start:string; end:string|null; reason:string; decision:'pending'|'approved'|'rejected'; reviewedBy?:string; reviewNote?:string }
export const KINDS = ['manual','picking','packing','receiving','transfer','stocktake'] as const;
export type Kind=typeof KINDS[number];
export const STAGES=['todo','working','blocked','submitted','confirmed','cancelled'] as const;
export const parseJson=<T>(text:string|null|undefined,fallback:T):T=>{try{return JSON.parse(text||'') as T;}catch{return fallback;}};
const minute=(s:string)=>{const [h,m]=s.split(':').map(Number);return h!*60+m!;};
export function validCalendar(x:unknown):x is Calendar {
 const c=x as Calendar;if(!c||!Array.isArray(c.days)||!c.days.length||!c.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6))return false;
 if(![c.start,c.end].every(s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s)))return false;
 if(minute(c.start)>=minute(c.end))return false;
 return (!c.breakStart&&!c.breakEnd)||[c.breakStart,c.breakEnd].every(s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s))&&minute(c.start)<=minute(c.breakStart)&&minute(c.breakStart)<minute(c.breakEnd)&&minute(c.breakEnd)<=minute(c.end);
}
export function workMinutes(from:string,to:string,cal:Calendar):number {
 const a=Date.parse(from),b=Date.parse(to);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return 0;
 const offset=7*3600e3,day=86400e3;let total=0;
 // At most five years; API work records never accept client timestamps.
 for(let d=Math.floor((a+offset)/day)*day;d<=b+offset&&d< a+offset+day*1830;d+=day){
  if(!cal.days.includes(new Date(d).getUTCDay()))continue;
  const overlap=(s:number,e:number)=>Math.max(0,Math.min(b,d-offset+e*60000)-Math.max(a,d-offset+s*60000))/60000;
  total+=overlap(minute(cal.start),minute(cal.end));if(cal.breakStart&&cal.breakEnd)total-=overlap(minute(cal.breakStart),minute(cal.breakEnd));
 }
 return Math.max(0,total);
}
export function elapsed(r:{calendar:string;startedAt:string|null;submittedAt:string|null;waits:string},now:string){
 const cal=parseJson<Calendar|null>(r.calendar,null);if(!r.startedAt||!cal)return null;
 const end=r.submittedAt||now,waits=parseJson<Wait[]>(r.waits,[]);
 const excluded=waits.filter(w=>w.decision==='approved'&&w.end).reduce((n,w)=>n+workMinutes(w.start,w.end!,cal),0);
 return {minutes:Math.max(0,workMinutes(r.startedAt,end,cal)-excluded),excluded};
}
export interface ScoreInput {dueAt:string|null;cancelled:boolean;run:null|{stage:string;weight:number;standardMinutes:number;calendar:string;startedAt:string|null;submittedAt:string|null;waits:string;quality:string|null}}
export const vietnamMonth=(stamp:string)=>new Date(Date.parse(stamp)+7*3600e3).toISOString().slice(0,7);
export function scoreMonth(rows:ScoreInput[],month:string,now:string){
 const relevant=rows.filter(x=>!x.cancelled&&x.dueAt&&vietnamMonth(x.dueAt)===month);
 const due=relevant.filter(x=>Date.parse(x.dueAt!)<=Date.parse(now)||x.run?.stage==='confirmed');
 const missing=due.filter(x=>!x.run||!x.run.standardMinutes||!validCalendar(parseJson(x.run.calendar,null))||(x.run.stage==='confirmed'&&!['clean','error'].includes(x.run.quality||''))).length;
 const total=due.reduce((n,x)=>n+(x.run?.weight||1),0);let completed=0,onTime=0,clean=0,speed=0,pending=0;
 for(const x of due){const r=x.run;if(!r)continue;if(r.stage==='submitted'||parseJson<Wait[]>(r.waits,[]).some(w=>w.decision==='pending'))pending++;
  if(r.stage!=='confirmed'||!r.submittedAt)continue;const t=elapsed(r,now);if(!t)continue;
  completed+=r.weight;if(r.quality==='clean')clean+=r.weight;
  const cal=parseJson<Calendar>(r.calendar,null as never);
  if(Date.parse(r.submittedAt)<=Date.parse(x.dueAt!)||workMinutes(x.dueAt!,r.submittedAt,cal)<=t.excluded)onTime+=r.weight;
  speed+=r.weight*Math.min(1,r.standardMinutes/Math.max(1,t.minutes));
 }
 const ratio=(n:number,d:number)=>d?n/d:null;
 const rates={onTime:ratio(onTime,total),completion:ratio(completed,total),speed:ratio(speed,completed),quality:ratio(clean,completed)};
 const missingTiming=due.filter(x=>x.run?.stage==='confirmed'&&!(elapsed(x.run,now)?.minutes!>0)).length;
 const ready=total>0&&!missing&&!missingTiming&&completed>0&&!pending;
 const points=ready?{onTime:rates.onTime!*30,speed:rates.speed!*25,completion:rates.completion!*25,quality:rates.quality!*20}:null;
 const score=points?Math.round(Object.values(points).reduce((a,b)=>a+b,0)*100)/100:null;
 return {month,score,points,rates,totalWeight:total,completedWeight:completed,missing,missingTiming,pending,eligible:due.length,future:relevant.length-due.length,withoutDeadline:rows.filter(x=>!x.cancelled&&!x.dueAt).length};
}
export const bonusFactor=(score:number|null)=>score===null?null:score>=90?1:score>=80?.8:score>=70?.5:0;
