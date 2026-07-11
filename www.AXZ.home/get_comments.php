<?php
header('Content-Type: application/json');
$dir = __DIR__ . '/comments/';
$comments = [];
if (is_dir($dir)) {
    $files = glob($dir . '*.txt');
    rsort($files); // 最新的在前
    foreach ($files as $file) {
        $filename = basename($file, '.txt');
        // 文件名格式：2025-04-19_15-30-45
        $time = str_replace('_', ' ', $filename);
        $content = file_get_contents($file);
        $comments[] = [
            'time' => $time,
            'content' => $content
        ];
    }
}
echo json_encode(['success' => true, 'comments' => $comments]);