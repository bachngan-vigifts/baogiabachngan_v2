import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT'];
let stage='secrets', api, upload, rollback, browser, activated=false;
try {
 for(const name of names) if(!process.env[name]?.trim()) throw Error('missing');
 const user=process.env.CPANEL_USERNAME.trim(), token=process.env.CPANEL_API_TOKEN.trim();
 const raw=process.env.CPANEL_BASE_URL.trim(), base=new URL(raw.includes('://')?raw:'https://'+raw);
 if(base.protocol!=='https:'||!/^[a-zA-Z0-9_]+$/.test(user)) throw Error('invalid');
 if(!base.port) base.port='2083';
 const root=process.env.LOCKNLOCK_DOCROOT.trim().replace(/\/+$/,'');
 if(!root.startsWith('/home/'+user+'/')||root.includes('..')) throw Error('root');
 const dir=root+'/wp-content/mu-plugins', privateDir='/home/'+user;
 const pluginName='lnl-home-category-icons.php';
 api=async(fn,params)=>{
   const url=new URL('/execute/Fileman/'+fn,base);
   const isForm=params instanceof FormData;
   if(!isForm) for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
   const r=await fetch(url,{method:isForm?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:isForm?params:undefined,signal:AbortSignal.timeout(40000)});
   const j=await r.json();if(!r.ok||!j.status) throw Error('cpanel');
   return j.data;
 };
 upload=async(dest,name,content)=>{
   const form=new FormData();form.set('dir',dest);form.set('overwrite','1');
   form.set('file-1',new Blob([content],{type:'application/octet-stream'}),name);
   await api('upload_files',form);
 };

 stage='check_target';
 const files=await api('list_files',{dir});
 if(files.some(f=>f.file===pluginName))throw Error('already_exists');
 const code=readFileSync('web-lock/category-icons/lnl-home-category-icons.php','utf8');
 rollback=()=>upload(dir,pluginName,"<?php\ndefined('ABSPATH') || exit;\n// Disabled after failed verification.\n");
 stage='install';
 activated=true;
 await upload(dir,pluginName,code);
 const verified=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 if(verified.content!==code)throw Error('readback');
 stage='verify_desktop';
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1360,height:1004}});
 await page.goto('https://locknlockonline.com/?lnl_icons_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>document.querySelectorAll('.MenuInBanner .lnl-has-product-icon').length>=8,{},{timeout:45000});
 const stats=await page.evaluate(()=>({
 total:document.querySelectorAll('.MenuInBanner .ux-menu-link__link').length,
 loaded:document.querySelectorAll('.MenuInBanner .lnl-has-product-icon').length,
 bad:Array.from(document.querySelectorAll('.lnl-category-product-icon')).some(i=>!i.complete||!i.naturalWidth),
 outside:document.querySelectorAll('.lnl-category-product-icon').length-document.querySelectorAll('.MenuInBanner .lnl-category-product-icon').length
 }));
 console.log(JSON.stringify(stats));if(stats.bad||stats.outside||stats.total!==stats.loaded)throw Error('icons');
 await page.screenshot({path:'category-icons-desktop.png',fullPage:false});
 stage='verify_mobile';
 await page.setViewportSize({width:390,height:844});
 if(await page.locator('.lnl-category-product-icon:visible').count())throw Error('mobile_icons_visible');
 await page.screenshot({path:'category-icons-mobile.png',fullPage:false});
 console.log('CATEGORY_ICONS_DEPLOY_OK');
} catch {
 console.log('FAILED_STAGE='+stage);
 if(activated&&rollback)try{await rollback();console.log('CATEGORY_ICONS_DISABLED');}catch{console.log('ROLLBACK_FAILED');}
 process.exitCode=1;
} finally {if(browser)await browser.close();}
