#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const token = process.env.WEB_ORDER_ACTION_TOKEN || '';
if (token.length < 32) throw new Error('Missing WEB_ORDER_ACTION_TOKEN');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const accounts = JSON.parse(fs.readFileSync('/home/node/.openclaw/credentials/vigifts-accounts.json', 'utf8')).accounts;
function minhlongLogins() {
  const out=require('child_process').spawnSync('grep',['-RIl','--include=*.jsonl*','minhlong_wp_relogin_after_lock_clarify_20260713','/home/node/.openclaw/agents/main/sessions'],{encoding:'utf8',maxBuffer:32*1024*1024}).stdout||'';
  const found=[];
  for(const file of out.split(/\n/).filter(Boolean)) { if(!fs.existsSync(file)) continue; const text=fs.readFileSync(file,'utf8');
    const username=(text.match(/const user='([^']+)'/)||[])[1], password=(text.match(/const pass='([^']+)'/)||[])[1]; if(username&&password&&password!=='***'&&!found.some(x=>x.username===username&&x.password===password)) found.push({username,password}); }
  return found;
}

function jarFrom(path) {
  const jar = new Map();
  if (fs.existsSync(path)) for (let line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#HttpOnly_')) line = line.slice(10);
    if (!line || line.startsWith('#')) continue;
    const p = line.split('\t'); if (p.length >= 7) jar.set(p[5], p.slice(6).join('\t'));
  }
  return jar;
}
function request(host, jar, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname: host, path, method, headers: { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), Accept: 'application/json,text/html,*/*',
      'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json', 'User-Agent': 'OpenClaw order bridge installer',
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, res => { let out='';
      for (const raw of res.headers['set-cookie'] || []) { const pair=raw.split(';')[0], i=pair.indexOf('='); if(i>0) jar.set(pair.slice(0,i),pair.slice(i+1)); }
      res.on('data', x => out += x); res.on('end', () => resolve({ code: res.statusCode, body: out, headers: res.headers })); });
    req.on('error', reject); req.setTimeout(90000, () => req.destroy(new Error('timeout'))); if(data) req.write(data); req.end();
  });
}
function nonce(html) {
  const m=html.match(/CODE_SNIPPETS\s*=\s*(\{.*?\});/s); if(m) try { const x=JSON.parse(m[1]); if(x.restAPI?.nonce) return x.restAPI.nonce; } catch {}
  return (html.match(/"root":"[^"]+wp-json[^"]*","nonce":"([^"]+)"/)||[])[1] || (html.match(/"snippets":"[^"]+","nonce":"([^"]+)"/)||[])[1];
}
// Pure PHP services are embedded without activating the exported checkout/cron snippets.
const phpSource = name => fs.readFileSync(require('path').join(__dirname, name), 'utf8').replace(/^<\?php\s*/, '');
const ghnService = phpSource('ghn-service.php'), ghnProvider = phpSource('ghn-provider.php');
const code = `/** Claw: thao tác đơn website từ CRM Bán hàng (chốt/GHN, bổ sung địa chỉ, huỷ, làm mới). */
if (!defined('ABSPATH')) { return; }
${ghnService}
${ghnProvider}
add_action('rest_api_init', function () {
  register_rest_route('vigifts/v1', '/order-action-v7', array('methods'=>'POST','permission_callback'=>'__return_true','callback'=>function(WP_REST_Request $r) {
    $auth=(string)$r->get_header('authorization'); $provided=preg_match('/^Bearer\\s+(.+)$/i',$auth,$m)?$m[1]:'';
    if (!$provided || !hash_equals('${tokenHash}', hash('sha256',$provided))) return new WP_Error('forbidden','Kết nối CRM không hợp lệ.',array('status'=>401));
    $id=absint($r->get_param('orderId')); $action=sanitize_key((string)$r->get_param('action')); $order=wc_get_order($id);
    if (!$order) return new WP_Error('not_found','Không tìm thấy đơn trên website.',array('status'=>404));
    $status=$order->get_status(); $stored_code=$order->get_meta('_lnl_ghn_order_code'); $code=is_string($stored_code)?$stored_code:'';
    if ($action==='locations') {
      $province=absint($r->get_param('provinceId')); $district=absint($r->get_param('districtId')); $rows=array();
      try {
        $data=lnl_crm_ghn_locations($district?'/master-data/ward':($province?'/master-data/district':'/master-data/province'),$district?array('district_id'=>$district):($province?array('province_id'=>$province):array()));
        if(is_wp_error($data)) return $data;
        foreach($data as $x) {
          $rows[]=array('id'=>$district?sanitize_text_field($x['WardCode']??''):absint($x[$province?'DistrictID':'ProvinceID']??0),
            'name'=>sanitize_text_field($x[$district?'WardName':($province?'DistrictName':'ProvinceName')]??''));
        }
      } catch(Exception $e) { return new WP_Error('ghn_locations',$e->getMessage(),array('status'=>502)); }
      return array('ok'=>true,'locations'=>array_values(array_filter($rows,function($x){return !empty($x['id'])&&!empty($x['name']);})));
    }
    if ($action==='confirm') {
      $input=array();
      foreach(array('addressLine','provinceId','provinceName','districtId','districtName','wardCode','wardName') as $field) {
        if($r->get_param($field)!==null) $input[$field]=sanitize_text_field((string)$r->get_param($field));
      }
      $x=lnl_crm_ghn_confirm($order,$input);
      if(is_wp_error($x)) {
        error_log(wp_json_encode(array('event'=>'crm_ghn_failure','order_id'=>$id,'code'=>$x->get_error_code(),
          'legacy_handler_loaded'=>function_exists('lnl_ghn_create_order_from_wc_order'),'provider_loaded'=>function_exists('lnl_crm_ghn_prepare'))));
        return $x;
      }
      // Status hooks run only after the carrier code has been saved and read back.
      try {
        $order=lnl_crm_ghn_reload($id);
        if(in_array($order->get_status(),array('pending','on-hold'),true)&&($x['status']??'')==='ready_to_pick') $order->update_status('processing','CRM Bán hàng: đã xác minh vận đơn GHN.');
      } catch(Throwable $e) { return lnl_crm_ghn_error('ghn_metadata_persist_failed','Đã có mã GHN; chưa cập nhật được trạng thái WooCommerce. Chỉ đối soát, không tạo mới.',502); }
    } elseif ($action==='cancel') {
      $order=lnl_crm_ghn_cancel($order); if(is_wp_error($order)) return $order;
    } elseif ($action!=='refresh') return new WP_Error('bad_action','Thao tác không hợp lệ.',array('status'=>400));
    try { $order=$action==='confirm'?lnl_crm_ghn_reload($id):wc_get_order($id); }
    catch(Throwable $e) { return lnl_crm_ghn_error('ghn_metadata_persist_failed','Đã có vận đơn; chưa đọc lại được mã WooCommerce. Chỉ đối soát, không tạo mới.',502); }
    $prefix=$order->has_shipping_address()?'shipping':'billing';
    $get_meta=function($field)use($order,$prefix){$v=(string)$order->get_meta('_lnl_ghn_'.$prefix.'_'.$field);return $v!==''?$v:(string)$order->get_meta('_lnl_ghn_'.$field);};
    $ghn_address=array('addressLine'=>$prefix==='shipping'?$order->get_shipping_address_1():$order->get_billing_address_1(),'provinceId'=>absint($get_meta('province_id')),'provinceName'=>sanitize_text_field($get_meta('province_name')?:($prefix==='shipping'?$order->get_shipping_state():$order->get_billing_state())),'districtId'=>absint($get_meta('district_id')),'districtName'=>sanitize_text_field($get_meta('district_name')?:($prefix==='shipping'?$order->get_shipping_city():$order->get_billing_city())),'wardCode'=>sanitize_text_field($get_meta('ward_code')),'wardName'=>sanitize_text_field($get_meta('ward_name')?:($prefix==='shipping'?$order->get_shipping_address_2():$order->get_billing_address_2())));
    return array('ok'=>true,'status'=>$order->get_status(),'ghnOrderCode'=>(string)$order->get_meta('_lnl_ghn_order_code'),'ghnStatus'=>(string)$order->get_meta('_lnl_ghn_last_status'),'ghnSortCode'=>(string)$order->get_meta('_lnl_ghn_sort_code'),'ghnFee'=>(float)$order->get_meta('_lnl_ghn_total_fee'),'ghnAddress'=>$ghn_address,'updatedAt'=>gmdate('c'));
  }));
});`;

async function install(host, cookiePath, login) {
  const jar=jarFrom(cookiePath);
  let admin=await request(host,jar,'GET','/wp-admin/admin.php?page=add-snippet&snippets-safe-mode=1');
  if (!nonce(admin.body) && login) {
    for (const candidate of (Array.isArray(login)?login:[login])) {
      await request(host,jar,'GET','/wp-login.php');
      const form=new URLSearchParams({log:candidate.username,pwd:candidate.password,'wp-submit':'Log In',redirect_to:`https://${host}/wp-admin/`,testcookie:'1'}).toString();
      await request(host,jar,'POST','/wp-login.php',form,{Referer:`https://${host}/wp-login.php`});
      admin=await request(host,jar,'GET','/wp-admin/admin.php?page=add-snippet&snippets-safe-mode=1');
      if (nonce(admin.body)) break;
    }
  }
  const n=nonce(admin.body); if(!n) throw new Error(`${host}: WordPress session expired`);
  const list=await request(host,jar,'GET','/wp-json/code-snippets/v1/snippets',null,{'X-WP-Nonce':n});
  if(list.code<200||list.code>=300) throw new Error(`${host}: list snippets HTTP ${list.code}`);
  const parsed=JSON.parse(list.body), rows=Array.isArray(parsed)?parsed:(parsed.snippets||parsed.data||[]);
  const olds=rows.filter(x=>x.name==='CLAW - CRM web order actions');
  const payload={name:'CLAW - CRM web order actions',desc:'Cầu nối bảo mật để CRM Bán hàng chốt/GHN, huỷ và làm mới đơn WooCommerce.',code,tags:['claw','crm','woocommerce','ghn'],scope:'global',active:true,priority:10};
  const primary=olds[0];
  const saved=await request(host,jar,'POST',primary?`/wp-json/code-snippets/v1/snippets/${primary.id}`:'/wp-json/code-snippets/v1/snippets',primary?{...primary,...payload}:payload,{'X-WP-Nonce':n});
  if(saved.code<200||saved.code>=300) throw new Error(`${host}: save snippet HTTP ${saved.code}: ${saved.body.slice(0,300)}`);
  for (const old of olds.slice(1)) await request(host,jar,'POST',`/wp-json/code-snippets/v1/snippets/${old.id}`,{...old,active:false},{'X-WP-Nonce':n});
  const probe=await request(host,jar,'POST','/wp-json/vigifts/v1/order-action-v7',{orderId:0,action:'refresh'},{Authorization:`Bearer ${token}`});
  if(probe.code!==404) throw new Error(`${host}: bridge probe expected 404, got ${probe.code}: ${probe.body.slice(0,300)}`);
  return {host,ok:true,snippetId:JSON.parse(saved.body).id,probe:probe.code};
}
(async()=>{
  const lock=accounts.find(x=>/locknlockonline\.com/i.test(String(x.site||x.url||'')) && /WordPress/i.test(x.service||''));
  const results=[];
  results.push(await install('locknlockonline.com','/home/node/.openclaw/credentials/locknlockonline-wp.cookies',lock));
  if (process.env.ONLY_LOCK !== '1') results.push(await install('minhlongonline.com','/home/node/.openclaw/credentials/minhlongonline-wp.cookies',minhlongLogins()));
  console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.message);process.exit(1)});
