一个虚拟航司网站

# 小泽航空 · Air Xiao Ze (AXZ)

虚拟航司 仅用于模拟飞行

网站：[xiaobrook.com/axz/](https://xiaobrook.com/axz/) · English: [/axz/en/](https://xiaobrook.com/axz/en/)

---

## 这次改版做了什么

内容一个字没改。中文是唯一真源，英文版由中文翻译而来。原站的每一句中文都保留在
`axz-src/content/zh.json` 里，`scripts/check-axz-content.mjs` 会逐句核对，少一句就
构建失败。

主要变化：

- **有了字体。** 原站三个页面用了三套不同的操作系统默认字体。现在用 Noto Sans SC、
  Noto Serif SC 和 IBM Plex Mono，按用途和语言分别裁剪到本站真正用到的字形。
- **航路字符串终于用等宽字体了。** 原来 `.map-text { font-family: Consolas }` 这条
  样式写了，但没有用到任何元素上。
- **logo 出现在网站上了。** 原来 `小泽航空.png` 没有被任何页面引用过。
- **弹窗没有了。** 原站有 12 个 `<div onclick>` / `<span onclick>`，键盘和读屏软件
  完全够不到。现在内容直接展开在页面上，所有可点的东西都是真的按钮或链接。
- **备注栏。** 这是整个设计的骨架，来自 C# 飞行日志记录器里的两个「备注」字段
  （各带一个「无」的勾选框）。「重大事件」和「搞笑黑历史」并排放在同一条基线上。
- **判读台。** `.axzlog` 就是 6 个字节的 `AXZLOG` 加一段 gzip 压缩的 UTF-8 JSON，
  浏览器能直接解开，所以不需要服务器。文件不会上传到任何地方。

## 目录

```
axz-src/          源文件（内容、样式、脚本、字体、图）
  content/        zh.json 是真源，en.json 由它生成
scripts/          构建与校验
axz/              构建产物，直接部署
AXZ-HTML/         原站，保留作为参考
```

## 构建

```bash
node scripts/subset-axz-fonts.mjs   # 需要 fonttools，见 axz-src/fonts-src/README.md
node scripts/build-axz.mjs
```

字体子集已经提交，所以第一步通常可以跳过。

## 校验

五道关，全部要过：

```bash
node scripts/check-axz-content.mjs    # 原站每一句中文都还在
node scripts/check-axz-contrast.mjs   # 33 组对比度实算，不用估值
node scripts/check-axz-en.mjs         # 英文固定译法 + 结构对齐
node scripts/axe-axz.mjs              # WCAG 2.2 AA，10 个页面 × 昼夜两套
node scripts/verify-axz.mjs           # 键盘、判读台、彩蛋页、双语接线
```

后两道需要先起本地服务：`node .axz-serve.mjs`（端口 4788）。

## 几件不要动的事

- **31100 英尺是对的。** 那是 9,500 米，中国的米制 RVSM 高度层。不要「改正」成
  31,000。`check-axz-en.mjs` 会拦。
- **留言板的三条留言不翻译。** 那是别人写的话，英文版里也保持中文原样，一个字节都
  不改。
- **`跑道震动器` 的英文是 the Runway Shaker。** 直译会翻成很不合适的词。
- **原站的错别字保留。** 「应为防水问题」照原样，这是这个网站的一部分。

## 无障碍

目标是 WCAG 2.2 AA。对比度按公式逐一算过，没有用估值。详见
[无障碍声明](https://xiaobrook.com/axz/accessibility/)。

## 字体授权

Noto Sans SC、Noto Serif SC、IBM Plex Mono 均为 SIL Open Font License 1.1。
