# Lena学英语 · 每日片段

每天一段 3–8 分钟的科技 / 商业访谈精华片段的播放页。只负责播放和展示：没有打卡、没有批改、没有后台，进度记在别处。

线上地址：https://lena-zhu.github.io/lena-clips/
每个片段的固定链接：`https://lena-zhu.github.io/lena-clips/#/c/<id>`

## 文件

```
index.html   页面骨架
style.css    样式（护眼 / 浅色 / 深色三套主题）
app.js       全部逻辑（列表、播放器、逐句同步、单句循环）
clips/
  index.json     片段列表
  <id>.json      每个片段一个文件
```

纯静态，没有构建步骤。本地预览：`python -m http.server 8791`，打开 http://127.0.0.1:8791/ 。

## 数据格式

`clips/index.json`

```json
{"clips":[{"id":"d01-amodei","day":1,"date":"2026-11-16","show":"Dwarkesh Podcast","guest":"Dario Amodei",
           "title_zh":"…","topic":"AI","youtube":"n1E9IZfvGMA","start":1234.5,"end":1560.0,"structure":"支架句 fronting"}]}
```

`clips/<id>.json`

```json
{"id":"…","day":1,"date":"…","show":"…","guest":"…","title_zh":"…","topic":"…",
 "youtube":"视频 id","start":1234.5,"end":1560.0,"structure":"…",
 "intro_zh":"这段在聊什么（2–3 句）",
 "sents":[{"i":0,"s":1234.5,"e":1239.1,"spk":"Dario Amodei","en":"…","zh":"…",
           "hl":[{"text":"What surprised me was","note":"支架句：先定句子形状"}]}],
 "shadow":[{"i":12,"tips":"断句 / 重音 / 连读说明"}],
 "questions":["What surprised you most about …?"],
 "chunks":[{"en":"…","zh":"…","i":7}]}
```

- `start` / `end` / `s` / `e` 都是 YouTube 视频里的绝对秒数。
- `hl[].text` 必须是 `en` 里一字不差的片段，否则不会高亮。
- `shadow[].i`、`chunks[].i` 对应 `sents[].i`（不是数组下标）；`shadow` 里找不到对应句子的条目不显示。
- 必填只有 `id`、`youtube`、`start`、`end`、`sents`，其余缺了页面照常显示。
- 句子缺 `e` 时，用下一句的 `s`（最后一句用片段的 `end`）。
- 首页按 `day` 从大到小排；`day` 为 0 显示成「样例」。

## 加一个片段

1. 把 `<id>.json` 放进 `clips/`。
2. 在 `clips/index.json` 的 `clips` 里加一条同样 id 的摘要。
3. `git add -A && git commit -m "add <id>" && git push`，一两分钟后线上生效。
