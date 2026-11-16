<?php
define('ABSPATH', '/tmp/lnl-tests/');
define('HOUR_IN_SECONDS', 3600);
function add_action(...$args) {}
require __DIR__ . '/lnl-store-ai-bridge.php';
function check($condition, $message) {
	if (!$condition) { throw new RuntimeException($message); }
}
check(lnl_gm_budget('bình dưới 500.000đ') === 500000.0, 'VND grouping');
check(lnl_gm_budget('dưới 500k') === 500000.0, 'thousands');
check(lnl_gm_budget('tối đa 1,5 triệu') === 1500000.0, 'millions');
check(lnl_gm_budget('bình giữ nhiệt') === null, 'no budget');
check(lnl_gm_ready() === false, 'inactive without credentials');
class WP_Query {
	public $posts = array(1,2,3,4,5);
	public function __construct($args) { check($args['post_status'] === 'publish', 'public only'); }
}
class Product {
	private $id;
	function __construct($id) {$this->id=$id;}
	function is_visible() {return $this->id!==4;}
	function is_purchasable() {return true;}
	function is_in_stock() {return $this->id!==3;}
	function get_price() {return $this->id===2 ? 600000 : 300000;}
	function get_id() {return $this->id;}
	function get_name() {return 'Bình giữ nhiệt';}
	function get_permalink() {return 'https://locknlockonline.com/san-pham/test-'.$this->id.'/';}
	function get_image_id() {return 1;}
	function get_price_html() {return '300.000đ';}
	function is_type($type) {return false;}
	function get_short_description() {return 'Bình';}
}
function wc_get_products() {}
function wc_get_product($id) {return new Product($id);}
function wc_get_price_to_display($p) {return $p->get_price();}
function wp_strip_all_tags($s) {return strip_tags($s);}
function esc_url_raw($s) {return $s;}
function wp_get_attachment_image_url(...$args) {return 'https://locknlockonline.com/image.jpg';}
function wc_placeholder_img_src() {return '';}
function wp_kses_post($s) {return $s;}
$p=lnl_gm_products('Bình giữ nhiệt dưới 500k');
check(array_column($p,'id')===array(1,5), 'budget, hidden and unavailable products excluded');
check(lnl_gm_products('Xin chào')===array(), 'no unrelated products');
echo "PRODUCT_AND_BUDGET_TESTS_OK\n";

check(lnl_gm_retryable(503), 'retry temporary provider failure');
check(lnl_gm_retryable(0), 'retry transport failure');
check(!lnl_gm_retryable(429), 'do not amplify quota failures');
check(!lnl_gm_retryable(401), 'do not retry invalid credentials');
$answer=lnl_gm_fallback('Mẫu nào 500ml?', array(
 array('name'=>'Bình A 500ml'), array('name'=>'Bình B 270ml')
));
check(strpos($answer,'Bình A')!==false && strpos($answer,'Bình B')===false, 'grounded capacity fallback');
check(lnl_gm_search('Tôi muốn bình giữ nhiệt dưới 500k')==='bình giữ nhiệt', 'intent extraction');
echo "RELIABILITY_TESTS_OK\n";

define('LNL_GEMINI_KEY','test-placeholder');
function add_option(...$args) {return true;}
function wp_salt() {return 'test-salt';}
function wp_next_scheduled(...$args) {return true;}
function sanitize_textarea_field($s) {return strip_tags($s);}
function wp_json_encode($v, $flags=0) {return json_encode($v,$flags);}
class WP_Error {}
function is_wp_error($v) {return $v instanceof WP_Error;}
function wp_remote_retrieve_response_code($v) {return $v['status'];}
function wp_remote_retrieve_body($v) {return $v['body'];}
class WP_REST_Response {
	private $data;
	function __construct($data,$status=200) {$this->data=$data;}
	function header(...$args) {}
	function get_data() {return $this->data;}
	function set_data($v) {$this->data=$v;}
}
class Request {
	function get_body() {return '{"message":"Bình giữ nhiệt dưới 500k"}';}
	function get_json_params() {return json_decode($this->get_body(),true);}
	function get_header($name) {return '';}
}
$calls=0;
$responses=array();
function wp_remote_post($url,$args) {
	global $calls,$responses;
	++$calls;
	check($args['timeout']<=9,'bounded timeout');
	return array_shift($responses);
}
$ok=array('status'=>200,'body'=>json_encode(array('candidates'=>array(array('content'=>array('parts'=>array(array('text'=>'Bình phù hợp'))),'finishReason'=>'STOP')))));
$responses=array(array('status'=>503,'body'=>'{}'),$ok);
$r=lnl_gm_chat(new Request());
check($calls===2 && $r->get_data()['provider']==='gemini','transient failure recovers');
$calls=0;
$responses=array(array('status'=>429,'body'=>'{}'));
$r=lnl_gm_chat(new Request());
check($calls===1 && $r->get_data()['provider']==='fallback','quota failure does not retry');
check(count($r->get_data()['products'])===2,'fallback retains store results');
echo "UPSTREAM_RECOVERY_TESTS_OK\n";
