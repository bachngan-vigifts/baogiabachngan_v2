import {createHash} from 'node:crypto';
const probe=createHash('sha256').update(process.env.CPANEL_API_TOKEN.trim()+':lnl-shipping-v1').digest('hex');
const r=await fetch('https://locknlockonline.com/wp-json/lnl-shipping/v1/purge',{method:'POST',headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(45000)});
const data=await r.json();if(!r.ok||!data.purged)throw Error('Targeted edge-cache purge did not confirm success');
const html=await (await fetch('https://locknlockonline.com/',{signal:AbortSignal.timeout(45000)})).text();
if(!html.includes('select2:select.lnlShipping'))throw Error('Ordinary homepage still serves old ETA code');
console.log('LOCK_ETA_EDGE_CACHE_REFRESHED; public mobile address handler verified');
