import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {productionDrive} from '../../src/core/storage/production-drive.ts';
const bytes=new TextEncoder().encode('%PDF-1.7\nfixture'),sha=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
test('Drive uses fixed OAuth/API hosts, generated IDs, private parents, checksum readback and safely reconciles a lost create reply',async()=>{
 const files=new Map<string,any>();let tokenCalls=0,creates=0,lose=false;let id='fixture_file_1234567890';const parent='fixture_parent_1234567890',folder='fixture_folder_1234567890';
 const fetcher=(async(url:string|URL|Request,init:any)=>{const u=new URL(String(url));assert.equal(init.redirect,'manual');if(u.hostname==='oauth2.googleapis.com'){tokenCalls++;assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');return Response.json({access_token:'fixture-access',expires_in:3600});}
  assert.equal(u.hostname,'www.googleapis.com');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-access');assert.ok(!u.searchParams.has('access_token'));if(u.pathname.endsWith('/permissions')){assert.ok(!init.method||init.method==='GET');return Response.json({permissions:[{type:'user'}]});}
  if(u.pathname.endsWith('/generateIds'))return Response.json({ids:[id]});
  if(init.method==='POST'&&u.searchParams.get('uploadType')==='multipart'){creates++;const type=new Headers(init.headers).get('content-type')||'';assert.match(type,/^multipart\/related; boundary=/);const boundary=type.split('boundary=')[1]!,parts=(await init.body.text()).split('--'+boundary),meta=JSON.parse(parts[1].split('\r\n\r\n')[1].trim());assert.equal(meta.id,id);assert.deepEqual(meta.parents,[folder]);assert.equal(meta.appProperties.crm_sha256,sha);assert.deepEqual(new TextEncoder().encode(parts[2].slice(parts[2].indexOf('\r\n\r\n')+4,-2)),bytes);files.set(id,{...meta,size:bytes.length,md5Checksum:md5});if(lose){lose=false;throw Error('lost fixture reply');}return Response.json({id});}
  if(init.method==='POST'){const data=JSON.parse(init.body);assert.equal(data.mimeType,'application/vnd.google-apps.folder');assert.deepEqual(data.parents,[parent]);files.set(data.id,data);return Response.json({id:data.id});}
  const key=u.pathname.split('/').pop()!;if(u.searchParams.get('alt')==='media')return new Response(bytes);return files.has(key)?Response.json(files.get(key)):new Response(null,{status:404});
 }) as typeof fetch;
 const d=productionDrive({clientId:'fixture-client',clientSecret:'fixture-secret',refreshToken:'fixture-refresh',folderId:parent,fetch:fetcher});assert.equal(await d.reserveId(),id);await d.ensureFolder(folder,'Báo giá thử','quote-fixture');await d.put(id,folder,'file.pdf',bytes,'application/pdf',sha,md5);id='fixture_second_1234567890';await d.reserveId();lose=true;await assert.rejects(()=>d.put(id,folder,'file.pdf',bytes,'application/pdf',sha,md5));await d.put(id,folder,'file.pdf',bytes,'application/pdf',sha,md5);assert.equal(creates,2);assert.equal(tokenCalls,1);
 assert.deepEqual(new Uint8Array(await(await d.read(id,{parent:folder,bytes:bytes.length,sha256:sha,md5})).arrayBuffer()),bytes);
 files.get(id).md5Checksum='tampered';await assert.rejects(()=>d.put(id,folder,'file.pdf',bytes,'application/pdf',sha,md5));await assert.rejects(()=>d.read(id,{parent:folder,bytes:bytes.length,sha256:sha,md5}));assert.equal(creates,2);
});

test('public Drive destinations are rejected before any file/folder creation',async()=>{
 let writes=0;const d=productionDrive({clientId:'fixture',clientSecret:'fixture',refreshToken:'fixture',folderId:'fixture_root_12345678',fetch:(async(url:any,init:any)=>{if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'fixture',expires_in:3600});if(init.method==='POST')writes++;return Response.json({permissions:[{type:'anyone'}]});}) as typeof fetch});await assert.rejects(()=>d.ensureFolder('fixture_folder_12345678','Folder','q'),/công khai/);assert.equal(writes,0);
});
