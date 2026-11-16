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
