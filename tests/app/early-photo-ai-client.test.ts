import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {claudePhotoReader} from '../../src/modules/suppliers/api/photo-ai.ts';
import {AppError} from '../../src/core/errors.ts';

/** Máy chủ giả đứng thay API thật: không có lượt gọi nào ra ngoài và không dùng khoá thật. */
async function fake(reply:(body:any)=>{status?:number;body:unknown;delayMs?:number}){
 const seen:{headers:Record<string,unknown>;body:any;path:string}[]=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c as Buffer);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));seen.push({headers:req.headers,body,path:req.url||''});
  const r=reply(body);if(r.delayMs)await new Promise(done=>setTimeout(done,r.delayMs));res.writeHead(r.status??200,{'content-type':'application/json'}).end(JSON.stringify(r.body));}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 return {seen,baseURL:'http://127.0.0.1:'+(server.address() as AddressInfo).port,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
const message=(text:string,over:Record<string,unknown>={})=>({id:'msg_1',type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'thinking',thinking:'',signature:'s'},{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1500,output_tokens:400},...over});
const image={mediaType:'image/jpeg' as const,data:'/9j/AAAA'};
const status=async(run:Promise<unknown>)=>{try{await run;}catch(e){assert.ok(e instanceof AppError,String(e));return [e.status,e.code];}assert.fail('expected an error');};

test('Claude photo reader sends the fixed model, schema and image, and returns parsed JSON with usage',async()=>{
 const api=await fake(()=>({body:message('{"readable":true,"rows":[]}')}));
 try{
  const out=await claudePhotoReader('test-key',{baseURL:api.baseURL})(image);
  assert.deepEqual(out,{output:{readable:true,rows:[]},model:'claude-opus-5-5',inputTokens:1500,outputTokens:400});
  const sent=api.seen[0]!;assert.match(sent.path,/^\/v1\/messages/);assert.equal(sent.headers.authorization,'Bearer test-key');assert.match(String(sent.headers['anthropic-beta']),/server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model,'claude-opus-5-5');assert.equal(sent.body.fallbacks,'default');assert.equal(sent.body.output_config.effort,'high');assert.equal(sent.body.output_config.format.type,'json_schema');
  assert.deepEqual(sent.body.output_config.format.schema.properties.rows.items.required,['sku','quantity','uncertain']);
  for(const absent of ['temperature','top_p','top_k','thinking','tool_choice','system'])assert.equal(absent in sent.body,false,absent);
  const content=sent.body.messages[0].content;assert.deepEqual(content[0],{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'/9j/AAAA'}});assert.match(content[1].text,/SL giao/);
 }finally{await api.close();}
});

test('Claude photo reader maps refusals, truncation, bad JSON and API failures to safe errors without retries',async()=>{
 const cases:[()=>{status?:number;body:unknown},unknown[]][]=[
  [()=>({body:message('',{stop_reason:'refusal',content:[]})}),[422,'photo_ai_rejected']],
  [()=>({body:message('{"readable":',{stop_reason:'max_tokens'})}),[422,'photo_ai_too_long']],
  [()=>({body:message('not json')}),[502,'photo_ai_failed']],
  [()=>({status:401,body:{type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}}),[503,'photo_ai_unavailable']],
  [()=>({status:429,body:{type:'error',error:{type:'rate_limit_error',message:'slow down'}}}),[503,'photo_ai_busy']],
  [()=>({status:400,body:{type:'error',error:{type:'invalid_request_error',message:'image too large'}}}),[422,'photo_ai_rejected']],
  [()=>({status:529,body:{type:'error',error:{type:'overloaded_error',message:'overloaded'}}}),[502,'photo_ai_failed']],
 ];
 for(const [reply,expected] of cases){const api=await fake(reply);try{assert.deepEqual(await status(claudePhotoReader('k',{baseURL:api.baseURL})(image)),expected);assert.equal(api.seen.length,1,'one paid attempt only');}finally{await api.close();}}
 const slow=await fake(()=>({body:message('{}'),delayMs:1500}));
 try{assert.deepEqual(await status(claudePhotoReader('k',{baseURL:slow.baseURL,timeoutMs:200})(image)),[504,'photo_ai_timeout']);}finally{await slow.close();}
});
