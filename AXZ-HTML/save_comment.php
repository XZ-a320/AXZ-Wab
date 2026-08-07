<?php
header('Content-Type: application/json');
$content = $_POST['content'] ?? '';
if (empty($content)) {
    echo json_encode(['success' => false, 'error' => '内容为空']);
    exit;
}
if (mb_strlen($content, 'UTF-8') > 100) {
    echo json_encode(['success' => false, 'error' => '留言超过100字']);
    exit;
}
$dir = __DIR__ . '/comments/';
if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
}
$time = date('Y-m-d_H-i-s');
$filename = $dir . $time . '.txt';
// 只保存留言内容（不含时间，时间从文件名读取）
file_put_contents($filename, $content, LOCK_EX);
echo json_encode(['success' => true]);