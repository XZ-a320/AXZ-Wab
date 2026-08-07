<?php
/**
 * 小泽航空 - 获取飞行日志列表
 * 扫描 flightlog/ 目录，返回所有 .axzlog 文件的信息
 */

header('Content-Type: application/json; charset=utf-8');

$logDir = __DIR__ . '/flightlog/';
$logs = [];

if (is_dir($logDir)) {
    $files = scandir($logDir);
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        $fullPath = $logDir . $file;
        if (is_file($fullPath) && strtolower(pathinfo($file, PATHINFO_EXTENSION)) === 'axzlog') {
            $logs[] = [
                'name' => $file,
                'size' => formatSize(filesize($fullPath)),
                'time' => date('Y-m-d H:i:s', filemtime($fullPath))
            ];
        }
    }
    // 按上传时间倒序（最新在前）
    usort($logs, function($a, $b) {
        return strcmp($b['time'], $a['time']);
    });
}

echo json_encode($logs);

// 辅助函数：格式化文件大小
function formatSize($bytes) {
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 2) . ' MB';
    } elseif ($bytes >= 1024) {
        return round($bytes / 1024, 2) . ' KB';
    }
    return $bytes . ' B';
}