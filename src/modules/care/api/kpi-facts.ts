import {and,gte,lt,inArray} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {customerActivities} from '../schema.ts';
import {activityKpi} from '../domain/activity-kpi.ts';
/** Complete month, before pagination. No revenue or payroll data leaves the care module. */
export async function activityFacts(db:AnyDb,from:string,next:string,ids?:readonly string[]){
 const rows=await db.select().from(customerActivities).where(and(gte(customerActivities.occurredAt,new Date(from+'T00:00:00+07:00').toISOString()),lt(customerActivities.occurredAt,new Date(next+'T00:00:00+07:00').toISOString()),ids?inArray(customerActivities.ownerId,[...ids]):undefined));
 const quoteIds=[...new Set(rows.filter(a=>a.type==='quote'&&a.quoteId).map(a=>a.quoteId!))];
 const history=quoteIds.length?await db.select().from(customerActivities).where(inArray(customerActivities.quoteId,quoteIds)):[];
 const marks=activityKpi([...new Map([...history,...rows].map(a=>[a.id,a])).values()]),counts=new Map<string,number>();for(const a of rows)if(marks.get(a.id)?.counted)counts.set(a.ownerId,(counts.get(a.ownerId)||0)+1);
 return{rows,marks,counts};
}
