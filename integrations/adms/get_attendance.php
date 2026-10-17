<?php
// Cài vào iclock/api/get_attendance.php trên máy chủ ADMS, PHP >= 7.4.
// db.php ở iclock/db.php phải cung cấp biến $pdo (PDO MySQL).
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    reply(405, ['status' => 'error', 'message' => 'Method not allowed']);
}
$secret = getenv('CRM_ADMS_TOKEN') ?: '';
$allowedCompany = filter_var(getenv('CRM_ADMS_COMPANY_ID'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (strlen($secret) < 32 || $allowedCompany === false) {
    reply(503, ['status' => 'error', 'message' => 'API not configured']);
}
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!hash_equals('Bearer ' . $secret, $auth)) {
    reply(401, ['status' => 'error', 'message' => 'Unauthorized']);
}
function intParam(string $name, int $default, int $max): int {
    $value = $_GET[$name] ?? (string)$default;
    if (!is_string($value) || !ctype_digit($value) || (float)$value < 1 || (float)$value > $max) {
        reply(400, ['status' => 'error', 'message' => 'Invalid parameter']);
    }
    return (int)$value;
}
$company = intParam('company_id', 0, PHP_INT_MAX);
if ($company !== $allowedCompany) reply(403, ['status' => 'error', 'message' => 'Forbidden']);
$limit = intParam('limit', 200, 200);
$page = intParam('page', 1, 10000);
$zone = new DateTimeZone('Asia/Ho_Chi_Minh');
function dateParam(string $name, DateTimeZone $zone): DateTimeImmutable {
    $value = $_GET[$name] ?? '';
    $d = is_string($value) ? DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, $zone) : false;
    if (!$d || $d->format('Y-m-d H:i:s') !== $value) {
        reply(400, ['status' => 'error', 'message' => 'Invalid date']);
    }
    return $d;
}
$from = dateParam('from_date', $zone);
$to = dateParam('to_date', $zone);
if ($from > $to || $to->getTimestamp() - $from->getTimestamp() >= 31 * 86400) {
    reply(400, ['status' => 'error', 'message' => 'Range must be at most 31 days']);
}
$emp = $_GET['emp_code'] ?? '';
if (!is_string($emp) || strlen($emp) > 100 || preg_match('/[\x00-\x1f]/', $emp)) {
    reply(400, ['status' => 'error', 'message' => 'Invalid employee code']);
}
try {
    require dirname(__DIR__) . '/db.php';
    if (!isset($pdo) || !($pdo instanceof PDO)) throw new RuntimeException('PDO unavailable');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $where = 'c.company_id = ? AND c.check_time BETWEEN ? AND ?';
    $params = [$company, $from->format('Y-m-d H:i:s'), $to->format('Y-m-d H:i:s')];
    if ($emp !== '') { $where .= ' AND c.user_id_on_device = ?'; $params[] = $emp; }
    $count = $pdo->prepare('SELECT COUNT(*) FROM checkin_logs c WHERE ' . $where);
    $count->execute($params);
    $total = (int)$count->fetchColumn();
    $sql = 'SELECT CAST(c.id AS CHAR) AS log_id, c.company_id, CAST(c.user_id_on_device AS CHAR) AS emp_code,
                   e.full_name, c.check_time, c.punch_state, c.sn AS device_serial, c.source
            FROM checkin_logs c
            LEFT JOIN employees e ON e.company_id = c.company_id AND e.emp_code = c.user_id_on_device
            WHERE ' . $where . ' ORDER BY c.check_time DESC, c.id DESC LIMIT ? OFFSET ?';
    $stmt = $pdo->prepare($sql);
    foreach ($params as $i => $value) $stmt->bindValue($i + 1, $value);
    $stmt->bindValue(count($params) + 1, $limit, PDO::PARAM_INT);
    $stmt->bindValue(count($params) + 2, ($page - 1) * $limit, PDO::PARAM_INT);
    $stmt->execute();
    reply(200, ['status' => 'success', 'total' => $total, 'page' => $page, 'limit' => $limit, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    // Không trả thông báo PDO, địa chỉ DB hoặc bí mật cho client.
    error_log('CRM ADMS attendance query failed');
    reply(500, ['status' => 'error', 'message' => 'Unable to read attendance']);
}
