import assert from 'node:assert/strict';
import {setup} from './pos-fixture.ts';
import {employees,positions} from '../../src/modules/staff/schema.ts';
import {customerCreateFixture} from './customer-fixture.ts';
export async function customerShareOptionsFixture(){
 const f=await setup(),now=new Date().toISOString();
 await f.db.insert(positions).values([{id:'it',name:'IT'},{id:'thiet-ke',name:'Thiết kế'},{id:'warehouse',name:'Kho'},{id:'share-custom',name:'Chức vụ khác'}]).onConflictDoNothing();
 await f.db.insert(employees).values(['it','thiet-ke','warehouse','share-custom'].map(positionId=>({id:'share-'+positionId,email:positionId+'@fixture.test',name:'Nhân viên '+positionId,role:'employee' as const,positionId,active:true,createdAt:now})));
 const made=await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách kiểm thử chia sẻ',ownerId:'emp',address:'Quận 1, TP Hồ Chí Minh'}));assert.equal(made.status,201,JSON.stringify(made.data));
 return {...f,id:made.data.id as string,now};
}
