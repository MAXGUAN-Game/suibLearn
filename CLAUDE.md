# SubLearn

最新功能、AI 设置、验证及服务器发布记录见 [docs/development-handoff.md](docs/development-handoff.md)（2026-11-11）。继续开发前先读该交接文件。

视频 + 字幕学习平台，主攻日语。上传视频和字幕文件，自动解析并生成学习模式（逐句播放、AB 循环、罗马音标注、变速、合集管理等），任何设备都能通过网页访问。

部署在阿里云 Ubuntu 上，Docker Compose 拉起。

## 技术栈

- **后端**：FastAPI 0.115 + Python 3 + aiosqlite（异步 SQLite），单文件数据库 `sublearn.db`
- **前端**：React 19 + React Router v7 + TypeScript + Tailwind v4，Vite 构建
- **LLM**：通义千问 Qwen3-Omni（DashScope 兼容 OpenAI SDK），用于翻译（目前未接入上传流程，代码就绪待启用）
- **日语注音**：pykakasi
- **视频处理**：ffmpeg（MKV 自动 remux 为 MP4 流复制）
- **部署**：Docker Compose + Nginx Alpine，Nginx 直接 serve 媒体文件

## 目录速览

```
backend/
  app/
    main.py               # FastAPI 入口，挂载 routers 和 /media 静态
    config.py             # 环境变量加载
    models/database.py    # SQLite schema + 所有 CRUD
    routers/
      upload.py           # POST /api/upload 上传视频+字幕
      library.py          # GET/DELETE /api/videos/*，POST /api/videos/batch/move
      collections.py      # /api/collections/* CRUD + 封面图
    services/
      subtitle_parser.py  # SRT/ASS/SSA 解析，双语识别，编码自动检测
      annotation.py       # 罗马音注音（pykakasi）
      translator.py       # LLM 翻译服务（已写未启用）
      storage.py          # 文件管理、MKV→MP4、容量统计
  requirements.txt
  .env.example            # 拷贝为 .env 填 LLM_API_KEY
frontend/
  src/
    App.tsx               # 路由定义
    services/api.ts       # 所有 API 调用 + 类型定义
    components/
      ContentLibrary/     # 全部视频页（含批量选择）
      CollectionList/     # 首页（合集网格）
      CollectionDetail/   # 合集详情
      UploadForm/         # 上传表单
      LearningPage/       # 学习主页，编排 VideoPlayer + SubtitlePanel
      VideoPlayer/        # 自研播放器（逐句/AB/变速/字幕叠加）
      SubtitlePanel/      # 右侧字幕栏（带罗马音）
  dist/                   # 构建产物，⚠️ 被 force-add 提交（见下）
  vite.config.ts          # /api 和 /media 代理到 :8000
docker-compose.yml        # backend + nginx 两服务
nginx.conf                # 1.1GB 上传上限，600s 超时
docs/deploy.md            # 阿里云部署指南
```

## 数据模型

三张表（`backend/app/models/database.py`）：

- **collections**：合集（id, name, cover_path, source_language）
- **videos**：视频（title, video_path, subtitle_path, status, collection_id FK → collections.id ON DELETE SET NULL, ...）
- **subtitle_lines**：字幕行（video_id FK ON DELETE CASCADE, index_num, start/end, original_text, translated_text, annotation JSON）

`init_db()` 是幂等的：`CREATE TABLE IF NOT EXISTS` + 动态 `ALTER TABLE` 加缺失列。已有数据库可以安全升级 schema。

## 本地开发

### 后端（端口 8000）

```bash
cd backend
cp .env.example .env                     # LLM_API_KEY 可留空（批量移动/基本功能不用）
python -m venv .venv
source .venv/Scripts/activate            # Windows Git Bash；Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

Vite 已配 `/api` 和 `/media` 代理到 `:8000`。打开 http://localhost:5173。

## 部署到阿里云

### 服务器信息

- 路径：`/opt/sublearn`
- 用户：以 `root` 身份管理（clone、git、docker 都是 root 做的）
- 登录账号通常是 `admin`，需 `sudo -i` 切 root
- Git 2.35+ 对非自己 owner 的仓库拒绝操作，如果换身份操作需先 `git config --global --add safe.directory /opt/sublearn`

### 更新流程（推荐以 root 在服务器上操作）

**本地**：

```bash
cd frontend && npm run build && cd ..
git add -f frontend/dist/
git add <其他改动>
git commit -m "..."
git push
```

**服务器**：

```bash
sudo -i
cd /opt/sublearn
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=30 backend
curl http://localhost/api/health
```

## 关键约定和坑

### frontend/dist 必须提交

`frontend/.gitignore` 默认忽略 `dist/`，但本仓库约定 **dist 要 force-add 提交**（`git add -f frontend/dist/`）。[docker-compose.yml](docker-compose.yml) 里 nginx 直接挂载 `./frontend/dist` 到 `/usr/share/nginx/html`，服务器 pull 后不需要再 `npm run build`（服务器可能没 node）。

**每次前端改动后**：本地先 `npm run build`，然后 `git add -f frontend/dist/`，单独做一次 commit（消息如 "Rebuild frontend dist with xxx feature"），再 push。否则服务器上 nginx 会继续 serve 旧版本。

### Docker 卷持久化

[docker-compose.yml:32-34](docker-compose.yml#L32-L34) 定义了两个命名卷：

- `backend-data` → `/app/data`（SQLite 数据库）
- `media-data` → `/data/sublearn/media`（上传的视频 + 合集封面）

`git pull` 完全不碰这俩（`.gitignore` 里排除了），`docker compose up -d --build` 只重建容器和镜像，**卷数据保留**。

**⚠️ 禁止执行** `docker compose down -v` —— `-v` 删命名卷，视频和数据库全清空。重启用 `up -d --build` 即可，`down` 一般不需要。

### CORS

[backend/app/main.py](backend/app/main.py) 目前 `allow_origins=["*"]`（开发期图方便）。上线前应收紧到实际域名。

### 未启用但已实现

- **LLM 翻译**（`services/translator.py`）：Qwen3-Omni 批量翻译器，30 条一批。目前 `upload.py` 的后台任务没调用它。启用方案：在 `_process_subtitles_background()` 里、注音完成后，按语言判断调用 `translate_batch()` 并 `update_subtitle_translations_batch()`。
- **视频缩略图**：`videos.thumbnail_path` 字段已存在但从未写入。可用 ffmpeg 在上传后抽首帧。

## 现有核心功能

- **密码保护**：单密码登录（JWT token，30天有效），所有 API 和页面受保护
- 上传视频 + 字幕（SRT/ASS/SSA），自动解析、编码检测、双语（日中）识别
- 日文罗马音注音（pykakasi）
- 自研播放器：逐句模式（自动暂停）、AB 循环、变速（0.25×–3×）、字幕叠加
- 右侧字幕栏：点击跳转、罗马音显示、单句 AB 循环
- 合集（collections）：CRUD、封面图、按合集过滤视频
- **批量选择视频移入/移出合集**（最近新增，`POST /api/videos/batch/move`）
- 存储容量管理（默认 30GB 上限）
- MKV 自动转 MP4（ffmpeg 流复制）

## 认证系统

单密码保护，无用户名/注册。

- **配置**：`.env` 中设 `AUTH_PASSWORD`（默认 `sublearn123`），可选配 `JWT_SECRET`、`JWT_EXPIRE_HOURS`（默认 720h = 30天）
- **流程**：打开网站 → 输入密码 → JWT 存 localStorage → 30天内免登录
- **后端**：`auth.py` 提供 `get_current_user` 依赖，挂在 upload/library/collections router 上；`/api/auth/login` 和 `/api/health` 不需要认证
- **前端**：`api.ts` 自动在所有请求加 Bearer header；401 时自动跳登录页
- **登出**：首页（合集列表）右上角"退出"按钮

## 可扩展方向（按价值排序）

1. **接入 LLM 翻译**：`translator.py` 已就绪，只需在上传后台任务里调用
2. **点词查义**：字幕分词后可点击单词调用词典（Jisho / LLM）显示释义
3. **SRS 复习**：新建 `word_reviews` 表，跟踪用户学习进度，spaced repetition
4. **缩略图生成**：ffmpeg 抽首帧到 `thumbnail_path`，UI 网格显示封面
5. **字幕在线编辑**：改字幕、调时轴，保存回数据库
6. **多用户体系**：目前单密码保护，可扩展为多用户各自内容隔离
7. **音频提取 / 听力专项**：ffmpeg 提取音轨，做纯听练习

## 术语速查

- "合集"（collection）：视频分组，可加封面
- "学习模式"（learning mode）：LearningPage 的整体交互
- "注音"（annotation）：JSON 格式存的罗马音 per-character 信息
- "逐句模式"（sentence mode）📖：每句字幕播完自动暂停
- "AB 循环" 🔄：在任意字幕行或时间段循环播放
