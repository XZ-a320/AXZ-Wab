<?php
/**
 * 小泽航空 - 飞行日志上传接口
 * 仅接受 .axzlog 文件，保存到 flightlog/ 目录
 */

header('Content-Type: application/json; charset=utf-8');

// 检查是否有文件上传
if (!isset($_FILES['logfile'])) {
    echo json_encode(['success' => false, 'message' => '未收到文件']);
    exit;
}

$file = $_FILES['logfile'];

// 检查上传错误
if ($file['error'] !== UPLOAD_ERR_OK) {
    echo json_encode(['success' => false, 'message' => '文件上传出错，错误码：' . $file['error']]);
    exit;
}

// 检查文件扩展名
$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if ($ext !== 'axzlog') {
    echo json_encode(['success' => false, 'message' => '仅允许上传 .axzlog 格式的文件']);
    exit;
}

// 上传目录
$uploadDir = __DIR__ . '/flightlog/';
if (!is_dir($uploadDir)) {
    if (!mkdir($uploadDir, 0755, true)) {
        echo json_encode(['success' => false, 'message' => '服务器无法创建上传目录']);
        exit;
    }
}

// 生成安全文件名（保留原始名称，但过滤路径字符）
$safeName = basename($file['name']);
$targetPath = $uploadDir . $safeName;

// 移动上传文件
if (move_uploaded_file($file['tmp_name'], $targetPath)) {
    echo json_encode(['success' => true, 'message' => '日志 ' . $safeName . ' 上传成功！']);
} else {
    echo json_encode(['success' => false, 'message' => '文件保存失败，请检查目录权限']);
}