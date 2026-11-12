/** Offline UI review server. Never proxies CRM, reads credentials or writes business data. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const repo=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.json':'application/json'};
export function createReviewServer(){return createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');
 if(u.pathname.startsWith('/api/')){const config=u.pathname.endsWith('/auth-config');res.writeHead(config?200:401,{'Content-Type':mime['.json']}).end(JSON.stringify(config?{turnstileSiteKey:''}:{error:'Bản duyệt giao diện không đăng nhập hoặc gửi dữ liệu lên CRM.'}));return;}
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
 const crm=u.pathname.startsWith('/crm/'),root=resolve(repo,crm?'trial-ui':'design/supplier-workspace');
 const relative=decodeURIComponent(crm?u.pathname.slice(5):u.pathname.slice(1))||'index.html',path=resolve(root,relative);
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 let data=await readFile(path);if(crm&&extname(path)==='.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/review-staff">'));
 res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'}).end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end('Không tìm thấy trang trong bản duyệt.');}});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||4175);createReviewServer().listen(port,'0.0.0.0',()=>console.log('Supplier UI review: http://localhost:'+port));}
