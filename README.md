# SyncTV Enhanced

基于 **SyncTV v0.9.15** 的增强版，保留旧版使用方式，补充内封文字字幕与文件排序。

- AList/OpenList、Emby/Jellyfin **原片直链**自动识别内封 ASS/SSA、SRT、VTT、MP4 文字字幕。
- ASS 使用 libass 渲染样式与字体；SRT 支持中途加载、拖动进度与语言切换。
- 名称、修改时间、类型、大小与升降序分别选择，文件夹优先、数字自然排序、记住选择。
- 完整目录先排序再分页（最多 10000 项）；普通房间列表另有添加时间排序。
- Jellyfin/Emby 目录一次读取后排序，避免为一个大型媒体库连续请求几十页。
- 聊天消息按房间保存在服务器，保留最近 500 条，退出、换设备或容器重启后自动恢复。
- 播放器右键“统计信息”显示片源编码、分辨率、位深、帧率、HDR 色彩标记、本机 HDR 能力及媒体服务器播放方式。
- MP4/MKV 原文件提供内封音轨选择；浏览器不支持默认音频编码时，自动启用 AAC 立体声兼容音频，视频仍按原文件播放。
- 两个服务通过一份 Compose 启动，沿用 v0.9.15 的 SQLite 数据结构。

## Docker 部署

将本仓库的 `compose.yaml`、`.env.example` 下载到同一目录，复制 `.env.example` 为 `.env` 后执行：

```sh
docker compose pull
docker compose up -d
```

访问 `http://服务器地址:8080`，端口通过 `.env` 中的 `SYNCTV_PORT` 修改。
固定版本 `0.9.15-enhanced.5` 的两个镜像名称如下；发布状态以 Actions 和 Packages 为准。

```text
ghcr.io/whitebr1ck/synctv-enhanced:0.9.15-enhanced.5
ghcr.io/whitebr1ck/synctv-enhanced-subtitles:0.9.15-enhanced.5
```

Actions 配置构建 `linux/amd64` 与 `linux/arm64`。
`./data` 保存账号和房间数据，`./data/subtitle-cache` 是自动生成和清理的字幕缓存。
聊天记录保存在同一数据库的独立表内，仅通过房间原有的访问验证后可读取；删除房间时一并清理。
旧版已经丢失的聊天记录无法恢复，播放器临时状态提示不写入聊天历史。
用户无需寻找或管理外挂字幕；视频不会因为字幕处理而重新编码。

## 更新、回退与迁移

修改 `.env` 中的 `SYNCTV_TAG`，执行 `docker compose pull` 和 `docker compose up -d` 即可更新或回退。
`edge` 用于开发验证，日常部署建议固定发行版本。

从 v0.9.15 迁移时，先停止原容器并备份完整 `data` 目录，再让新 Compose 使用同一个 `./data` 和原端口。
不要让两套服务同时写同一个 SQLite 数据库。原配置和旧版 Compose 请保留以便回退。
源码目录与部署目录可以分开，日常部署只需 Compose、`.env` 与镜像。

## 支持范围

- 大小与修改时间适用于 AList/OpenList 目录。搜索接口没有日期，搜索时日期排序会切回名称。
- Emby/Jellyfin 目录提供名称和类型排序。
- 仅有 HLS/DASH 转码流时，字幕需由媒体服务器提供或烧录。
- PGS/VobSub 图片字幕不在本版文字字幕范围内；本版不提供 HEVC 视频转码。
- HDR 使用浏览器原生播放链路，不增加 HDR→SDR 转换。能力检测不是实际 HDR 输出的确认；不同设备分别检测。
- 片源探测复用 AList/OpenList、Emby/Jellyfin 原文件的字幕探测结果，按需读取；HLS/DASH 或其他来源未提供信息时显示未知。
- 媒体服务器的“转换流”可能包含转封装或转码；该状态来自原有播放决策，本版只展示状态。
- AAC 兼容模式只处理音频，原视频及其 HDR 信息不变；“原声自动”保留浏览器原生音频播放。兼容音频会使用服务器算力与额外读取带宽，最多同时 8 路，关闭播放器或断开连接即停止。

## 从源码构建

```sh
git clone -b enhanced-v0.9.15 https://github.com/WhiteBr1ck/synctv-enhanced.git
cd synctv-enhanced
docker compose -f compose.yaml -f compose.build.yaml build
docker compose -f compose.yaml -f compose.build.yaml up -d --no-build
```

修改后的前端直接纳入 `synctv-web/`；`vendors/` 也纳入源码，保留原许可证，并精简 Jellyfin 目录请求中的播放源数据。
Docker 会自动编译前端、后端和字幕服务，无需额外安装 Node.js 或 Go。
直接运行测试时需安装 Node.js 24 与 FFmpeg：

```sh
node --test subtitle-gateway/gateway.test.mjs subtitle-gateway/timed-text.test.mjs subtitle-gateway/list-sort.test.mjs subtitle-gateway/chat-history.test.mjs subtitle-gateway/video-info.test.mjs subtitle-gateway/audio.test.mjs
go test ./internal/db ./utils
```

## 自动发布

维护分支 `enhanced-v0.9.15`、PR 和 `v0.9.15-enhanced.*` 标签触发测试与双架构构建。
通过检查的分支推送发布 `edge`，版本标签发布对应固定版本；PR 仅验证构建。
发布使用 Actions 自带的 `GITHUB_TOKEN`，无需在仓库中填写个人 Token。
首次发布后，将两个 GHCR 包的可见性设为 Public，才可匿名拉取镜像。

## 来源和许可证

- 后端：[synctv-org/synctv](https://github.com/synctv-org/synctv)，基于 `v0.9.15`（`ff29d6ef8bbaae2568807e9ae425ae6d3b3cf60a`），保留 Git 历史和根目录 `LICENSE`。
- 前端：[synctv-org/synctv-web](https://github.com/synctv-org/synctv-web)，基于 `4cdec2decfbd66b9ebd77bf8559cd0c696023583`，许可证保留在 `synctv-web/LICENSE`。
- vendors：[synctv-org/vendors](https://github.com/synctv-org/vendors)，基于 `2b77d56e38e089af556ddae0d21aafc803b886ea`，保留在 `vendors/`，许可证为 `vendors/LICENSE`。
- 原版说明保留在 `README.upstream.md` 及存在时的 `README-CN.upstream.md`。

这是独立维护的增强版 fork，并非上游官方发行版。
