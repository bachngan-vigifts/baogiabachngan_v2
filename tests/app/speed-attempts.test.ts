import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser transport
import {createApiTransport} from '../../trial-ui/api-transport.js';
// @ts-ignore browser speed log
import {recordApi,summarize,speedReport,clearSpeedEntries} from '../../trial-ui/speed-log.js';

test('Mỗi lần gửi thật được báo (quá giờ, 503, thành công) mà không đổi cách thử lại; lệnh ghi chỉ một lần',async()=>{
 let calls=0;const seen:any[]=[];
 const read=createApiTransport({timeoutMs:20,delay:async()=>{},fetcher:(_u:string,init:any)=>{calls++;
  if(calls===1)return new Promise((_r,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  return Promise.resolve(calls===2?new Response('{}',{status:503}):Response.json({ok:true}));}});
 assert.equal((await read('/tasks',{},{onAttempt:(a:any)=>seen.push(a)})).status,200);
 assert.equal(calls,3);assert.deepEqual(seen.map(a=>a.error||a.status),['timeout',503,200]);
 const writes:any[]=[];let w=0;const write=createApiTransport({fetcher:async()=>{w++;throw Error('net');}});
 await assert.rejects(write('/pos/checkout',{method:'POST',body:'{}'},{onAttempt:(a:any)=>writes.push(a)}));
 assert.equal(w,1);assert.deepEqual(writes.map(a=>a.error),['network']);
});

test('Đo tốc độ tách thời gian thử lại và đọc JSON khỏi phần mạng; báo số lần quá giờ / chuyển dự phòng',()=>{
 clearSpeedEntries();
 // Lần 1 (vùng gần CSDL) quá giờ 8 s → gửi lại máy chủ dự phòng: 600 ms; máy chủ 400 ms, đọc JSON 50 ms.
 recordApi({path:'/tasks',ms:8700,status:200,serverTiming:'db;dur=20, app;dur=380;desc="4 queries", total;dur=400',readMs:50,
  attempts:[{ms:8000,error:'timeout',region:true},{ms:600,status:200,region:false}]});
 recordApi({path:'/tasks',ms:500,status:200,serverTiming:'total;dur=300',readMs:20,attempts:[{ms:470,status:200,region:true}]});
 const r=summarize().routes[0];
 assert.equal(r.retries,1);assert.equal(r.timeouts,1);assert.equal(r.failovers,1);assert.equal(r.retryMs,8000);
 // Mạng của lượt 1: 8700 − 8000 − 50 − 400 = 250; lượt 2: 500 − 0 − 20 − 300 = 180.
 assert.equal(r.network,250);
 assert.match(speedReport(),/thử lại 1 lần \(quá giờ 1, chuyển dự phòng 1/);
 // Bản ghi cũ không có số lần thử vẫn tổng hợp được.
 clearSpeedEntries();recordApi({path:'/me',ms:300,status:200,serverTiming:'total;dur=100'});
 assert.equal(summarize().routes[0].network,200);assert.equal(summarize().routes[0].retries,0);
 clearSpeedEntries();
});

test('Lượt gọi lúc máy ngủ (đồng hồ hệ thống lệch đồng hồ đơn điệu) không vào trung vị / p90, báo số lượt bỏ qua',()=>{
 clearSpeedEntries();
 // Máy ngủ ~15 phút: performance.now đo 186 s, Date.now đo 1.080 s.
 recordApi({path:'/receivables',ms:186000,status:200,serverTiming:'total;dur=4000',wallMs:1080000,attempts:[{ms:90000,error:'timeout'},{ms:90000,error:'timeout'},{ms:5000,status:200}]});
 recordApi({path:'/receivables',ms:900,status:200,serverTiming:'total;dur=400',wallMs:905,attempts:[{ms:880,status:200}]});
 const s=summarize();
 assert.equal(s.paused,1);assert.equal(s.all.count,1);assert.equal(s.routes[0].median,900);assert.equal(s.routes[0].retries,0);
 assert.match(speedReport(),/bỏ qua 1 lượt lúc tab ẩn \/ máy ngủ/);
 clearSpeedEntries();
});
