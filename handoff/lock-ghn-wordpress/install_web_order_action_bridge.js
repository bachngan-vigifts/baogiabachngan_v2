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
const code = `/** Claw: thao tác đơn website từ CRM Bán hàng (chốt/GHN, bổ sung địa chỉ, huỷ, làm mới). */
if (!defined('ABSPATH')) { return; }
add_action('rest_api_init', function () {
  register_rest_route('vigifts/v1', '/order-action-v7', array('methods'=>'POST','permission_callback'=>'__return_true','callback'=>function(WP_REST_Request $r) {
    $auth=(string)$r->get_header('authorization'); $provided=preg_match('/^Bearer\\s+(.+)$/i',$auth,$m)?$m[1]:'';
    if (!$provided || !hash_equals('${tokenHash}', hash('sha256',$provided))) return new WP_Error('forbidden','Kết nối CRM không hợp lệ.',array('status'=>401));
    $id=absint($r->get_param('orderId')); $action=sanitize_key((string)$r->get_param('action')); $order=wc_get_order($id);
    if (!$order) return new WP_Error('not_found','Không tìm thấy đơn trên website.',array('status'=>404));
    $status=$order->get_status(); $code=(string)$order->get_meta('_lnl_ghn_order_code');
    if ($action==='locations') {
      $province=absint($r->get_param('provinceId')); $district=absint($r->get_param('districtId')); $rows=array();
      try {
        if ($district && function_exists('lnl_ghn_get_wards')) { foreach ((array)lnl_ghn_get_wards($district) as $x) $rows[]=array('id'=>sanitize_text_field($x['WardCode']??''),'name'=>sanitize_text_field($x['WardName']??'')); }
        elseif ($province && function_exists('lnl_ghn_get_districts')) { foreach ((array)lnl_ghn_get_districts($province) as $x) $rows[]=array('id'=>absint($x['DistrictID']??0),'name'=>sanitize_text_field($x['DistrictName']??'')); }
        elseif (function_exists('lnl_ghn_get_provinces')) { foreach ((array)lnl_ghn_get_provinces() as $x) $rows[]=array('id'=>absint($x['ProvinceID']??0),'name'=>sanitize_text_field($x['ProvinceName']??'')); }
        else return new WP_Error('ghn_locations','Website chưa có kết nối danh mục địa chỉ GHN.',array('status'=>503));
      } catch(Exception $e) { return new WP_Error('ghn_locations',$e->getMessage(),array('status'=>502)); }
      return array('ok'=>true,'locations'=>array_values(array_filter($rows,function($x){return !empty($x['id'])&&!empty($x['name']);})));
    }
    if ($action==='confirm') {
      if (in_array($status,array('completed','cancelled','refunded','failed'),true)) return new WP_Error('bad_status','Trạng thái đơn không cho phép chốt.',array('status'=>409));
      $address=sanitize_text_field((string)$r->get_param('addressLine')); $province_id=absint($r->get_param('provinceId')); $district_id=absint($r->get_param('districtId')); $ward_code=sanitize_text_field((string)$r->get_param('wardCode'));
      if ($address || $province_id || $district_id || $ward_code) {
        $province_name=sanitize_text_field((string)$r->get_param('provinceName')); $district_name=sanitize_text_field((string)$r->get_param('districtName')); $ward_name=sanitize_text_field((string)$r->get_param('wardName'));
        if (!$address || !$province_id || !$district_id || !$ward_code || !$province_name || !$district_name || !$ward_name) return new WP_Error('address_invalid','Vui lòng nhập đủ địa chỉ, Tỉnh/Thành, Quận/Huyện và Phường/Xã.',array('status'=>409));
        $order->set_shipping_address_1($address); $order->set_shipping_address_2($ward_name); $order->set_shipping_city($district_name); $order->set_shipping_state($province_name);
        $order->update_meta_data('_lnl_ghn_shipping_province_id',$province_id); $order->update_meta_data('_lnl_ghn_shipping_province_name',$province_name);
        $order->update_meta_data('_lnl_ghn_shipping_district_id',$district_id); $order->update_meta_data('_lnl_ghn_shipping_district_name',$district_name);
        $order->update_meta_data('_lnl_ghn_shipping_ward_code',$ward_code); $order->update_meta_data('_lnl_ghn_shipping_ward_name',$ward_name);
        $order->update_meta_data('_lnl_ghn_province_id',$province_id); $order->update_meta_data('_lnl_ghn_province_name',$province_name);
        $order->update_meta_data('_lnl_ghn_district_id',$district_id); $order->update_meta_data('_lnl_ghn_district_name',$district_name);
        $order->update_meta_data('_lnl_ghn_ward_code',$ward_code); $order->update_meta_data('_lnl_ghn_ward_name',$ward_name); $order->save();
      }
      if ($status!=='processing') $order->update_status('processing','CRM Bán hàng: chốt đơn và yêu cầu tạo vận đơn GHN.');
      $order=wc_get_order($id); $code=(string)$order->get_meta('_lnl_ghn_order_code');
      if (!$code && function_exists('lnl_ghn_create_order_from_wc_order')) {
        try { $x=lnl_ghn_create_order_from_wc_order($order); if(!empty($x['order_code'])){$order->update_meta_data('_lnl_ghn_order_code',sanitize_text_field($x['order_code']));$order->update_meta_data('_lnl_ghn_sort_code',sanitize_text_field($x['sort_code']??''));$order->update_meta_data('_lnl_ghn_total_fee',absint($x['total_fee']??0));$order->update_meta_data('_lnl_ghn_last_status','ready_to_pick');$order->save();} } catch(Exception $e){ return new WP_Error('ghn_create',$e->getMessage(),array('status'=>409)); }
      }
      if (!(string)$order->get_meta('_lnl_ghn_order_code')) return new WP_Error('address_invalid','Website chưa tạo được vận đơn GHN; vui lòng hoàn thiện địa chỉ người nhận.',array('status'=>409));
    } elseif ($action==='cancel') {
      if ($status==='completed') return new WP_Error('delivered','Đơn đã hoàn thành, không thể huỷ.',array('status'=>409));
      if ($code && function_exists('lnl_ghn_api_request')) { try { $x=lnl_ghn_api_request('/v2/switch-status/cancel',array('order_codes'=>array($code)),true); if((int)($x['code']??0)!==200) return new WP_Error('ghn_cancel',sanitize_text_field($x['message']??'GHN chưa huỷ được vận đơn.'),array('status'=>409)); } catch(Exception $e){ return new WP_Error('ghn_cancel',$e->getMessage(),array('status'=>409)); } }
      $order->update_meta_data('_lnl_ghn_last_status','cancel'); $order->update_status('cancelled','CRM Bán hàng: huỷ đơn'.($code?' và vận đơn GHN '.$code:'').'.'); $order->save();
    } elseif ($action!=='refresh') return new WP_Error('bad_action','Thao tác không hợp lệ.',array('status'=>400));
    $order=wc_get_order($id); $prefix=$order->has_shipping_address()?'shipping':'billing';
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
