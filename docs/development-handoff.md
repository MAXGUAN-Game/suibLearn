# SubLearn 开发交接（2026-11-11）

## 本次功能

- 播放器右下角提供“日语 / 日中字幕 / 无字幕”，默认日中字幕；只控制播放器字幕，右侧学习列表保留。
- 字幕模式左侧新增“解析”：暂停播放，锁定点击时的台词，在气泡浮窗中展示整句理解、中文译文、彩色语法分段与对应讲解。
- 彩色片段与解释按编号和颜色对应，可点击片段定位解释；支持加载、失败重试、关闭、Esc、外部点击和手机视口。
- 首页与学习页提供“AI 设置”，可自行配置 DeepSeek 的 API Key、服务地址和模型，并测试连接。
- 设置保存在服务器 SQLite 中，保存立即生效。Key 留空保留已有值，读取接口只返回是否配置，前端不回填或持久化 Key。

## 换电脑继续开发

```powershell
git clone https://github.com/MAXGUAN-Game/suibLearn.git
cd suibLearn
git pull --ff-only
cd frontend
npm.cmd ci
npm.cmd run dev
```

后端另开终端：

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 根据需要修改 .env；已有 .env 时不要覆盖。
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

前端 `5173` 将 `/api`、`/media` 代理到后端 `8000`。Linux/macOS 使用 `npm`、`.venv/bin/python`，并按其 shell 调整命令。

本地数据库和服务器数据库相互独立；服务器通过设置面板保存的 Key 不会随 Git 拉取到另一台电脑。在本地打开“AI 设置”单独配置即可。

## AI 配置

- 供应商：DeepSeek。
- 默认服务地址：`https://api.deepseek.com`。
- 默认模型：`deepseek-flash`；可在设置面板中修改。
- 可以用 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 设置初始值；界面保存的配置优先。
- 既有 `LLM_*` 仍属于字幕翻译配置，与语法解析分开。
- “测试连接”使用当前表单值发起短请求，不会自动保存配置；测试后仍需点保存。
- [DeepSeek 官方调用文档](https://api-docs.deepseek.com/)、[JSON 输出文档](https://api-docs.deepseek.com/guides/json_mode/)。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `frontend/src/components/VideoPlayer/VideoPlayer.tsx` | 字幕模式、解析按钮、暂停和台词选择、弹层互斥 |
| `frontend/src/components/GrammarAnalysis/` | 语法气泡、彩色分段和讲解、前端结果缓存 |
| `frontend/src/components/AISettings/` | AI 配置面板、连接测试、保存反馈 |
| `frontend/src/services/api.ts` | 前端 API 合同与认证 |
| `backend/app/routers/analysis.py` | 已鉴权的句子语法解析入口 |
| `backend/app/services/grammar.py` | DeepSeek 调用、输出校验、超时、并发合并和缓存 |
| `backend/app/routers/ai_settings.py` | 配置读取、更新和测试接口 |
| `backend/app/services/ai_settings.py` | 生效配置快照、Key 保留和连接测试 |
| `backend/app/models/database.py` | 配置和语法缓存持久化；启动时增量建表 |
| `backend/app/tests/test_grammar.py` | 语法服务回归测试 |
| `backend/app/tests/test_ai_settings.py` | 设置、密钥和连接测试回归 |

API 均复用现有登录认证：

- `POST /api/analysis/grammar`：`{text, translation?}` → `{sentence, translation, summary, segments:[{text, role, explanation}]}`。
- `GET /api/settings/ai`：读取公开配置，不返回 Key。
- `PUT /api/settings/ai`：保存 `{api_key?, base_url, model}`，空 Key 保留旧值。
- `POST /api/settings/ai/test`：测试表单配置，不保存。

语法服务要求所有 `segments.text` 拼接逐字等于原句，拒绝模型改写、漏字或不完整输出。DeepSeek 内部使用流式响应、JSON 模式、关闭思考模式、50 秒整体超时；浏览器收到完整且校验过的 JSON。相同请求合并，最多同时解析 3 个不同句子。SQLite 语法缓存最多 2000 条，配置版本参与缓存键；前端会话缓存最多 100 条。

## 检查命令

```powershell
# 在 backend 目录运行，确保 app 模块可以导入：
cd backend
.venv/Scripts/python.exe -m unittest discover -s app/tests -p "test_*.py" -v
cd ../frontend
npm.cmd run build
npx.cmd eslint src/components/VideoPlayer/VideoPlayer.tsx src/components/GrammarAnalysis/GrammarAnalysis.tsx src/components/GrammarAnalysis/grammarCache.ts src/components/AISettings/AISettingsButton.tsx
```

完整项目 ESLint 可能仍报告早已有的其他页面问题；本次新增和修改组件应单独检查。临时浏览器集成脚本、模拟供应商和测试数据库位于被 Git 忽略的 `tmp/`，不上传服务器。

## 部署约定

- 仓库：`https://github.com/MAXGUAN-Game/suibLearn.git`，分支 `main`。旧远程 `IrelansTA/suibLearn` 目前会重定向。
- 服务器：`root@118.178.178.123`，项目 `/opt/sublearn`，访问 `http://118.178.178.123`。
- Docker Compose：`sublearn-backend` 与 `sublearn-frontend`；Nginx 直接挂载 `frontend/dist`。
- **前端构建产物必须 `git add -f frontend/dist` 后提交**；只改源码不会更新线上页面。
- 本次涉及后端，更新源码后需要重建并启动 backend，再刷新 Nginx。只改静态文件时无需重建后端。
- 服务器 `nginx.conf` 存在域名配置的本地改动，更新时必须保留。
- 数据库在 `sublearn_backend-data`，视频在 `sublearn_media-data`。不要执行 `docker compose down -v`。
- SSH 凭证、`.env`、数据库及用户填写的 API Key 不进 Git。
- 如果服务器无法直接访问 GitHub，可在本地制作 `git bundle` 上传，在服务器校验后 `git fetch <bundle> HEAD`、`git merge --ff-only FETCH_HEAD`。必须校验提交号与本地发布版本一致。
- 如果 Git Credential Manager 保存了多个 GitHub 账号而 push 卡在选账号，可明确指定 `git -c credential.username=MAXGUAN-Game push origin main`，无需把凭证写入远程 URL。

## 本次发布与验证记录

- 功能提交：`74dc172`（DeepSeek 语法解析与 AI 设置）。
- 构建提交 / 线上功能版本：`af5387e`。
- 已发布到 `http://118.178.178.123`，Nginx 配置验证通过，`/api/health` 正常。
- 本地 Python 3.14 与服务器候选镜像 Python 3.11 均通过 23 项后端测试；TypeScript、Vite 构建和本次新增组件的 ESLint 通过。
- 浏览器已验证桌面与手机布局、彩色片段与讲解对应、暂停/切句、关闭与焦点、失败重试、缓存、原有字幕模式。
- 本地使用隔离 SQLite 和模拟 DeepSeek SSE 服务，验证了“设置表单 → 连接测试 → 保存 → 实际后端解析接口 → 彩色浮窗”的完整链路，以及空 Key 保留、不回显 Key、不把 Key 存浏览器。
- 公网浏览器确认已加载新版构建并通过字幕与浮窗交互验证（AI 响应用测试数据隔离）；服务器实际已鉴权接口确认设置读取正常、未配置 Key 时返回清晰的 503 提示。
- **用户还未填写 DeepSeek Key，所以没有调用真实 DeepSeek 验证生成质量。** 现在应在网站“AI 设置”填写 Key，测试连接并保存。
- 发布前后核对：13 个视频、4089 行字幕、1 个合集，数量一致；既有媒体和数据库保留。

本次服务器 Docker Hub 基础镜像下载缓慢，因此复用发布前已安装依赖的镜像，只覆盖 `app/` 代码，并先在候选镜像中跑完 23 项测试再切换。未修改仓库 Dockerfile 和 requirements。候选镜像标签 `sublearn-backend:grammar-af5387e`，运行标签 `sublearn-backend:latest`。后续常规部署仍可使用 Docker Compose 构建。

回滚材料只留在服务器：

- 源码、前端与 Nginx 备份：`/opt/sublearn-releases/20261111T055101Z-before-grammar/source-before.tar.gz`。
- 数据库在线一致性备份：后端数据卷内 `/app/data/backups/20261111T055101Z-before-grammar.db`。
- 发布前镜像：`sublearn-backend:before-grammar-20261111T055101Z`。
- 增量构建文件与日志位于上述 release 目录。

如需回滚应用，可将发布前镜像重新标为 `sublearn-backend:latest`，使用 `docker compose up -d --no-build --no-deps backend`，恢复备份中的前端和源码，再校验并 reload Nginx。新增的设置和缓存表与旧版兼容，应用回滚通常无需恢复数据库；避免覆盖发布后新增的数据。

## 追加：英语测试片与字幕按钮语言修复（2026-11-11）

- 已创建英语合集“摩登家庭 · 第一季”，使用用户指定的 `season01-poster.jpg` 作为合集封面。
- 已上传第一集供测试：[播放器](http://118.178.178.123/learn/f5ad6806-a02f-40f1-81df-27a7383e48c4)，合集 ID `0bfa8a2e-b780-4a91-9974-02b7ead1b020`。
- 测试片为本地原 MKV 派生的 1080p H.264/AAC MP4，不向画面烧录字幕，原视频保留。服务端解析出 506 条字幕，其中 496 组英中配对；实际网页播放、字幕关闭和封面检查通过。
- 修复了英语片仍显示“日语”的字幕菜单。`LearningPage` 将 `video.source_language` 传给 `VideoPlayer.sourceLanguage`；字幕模式状态使用 `original / bilingual / off`，与语言标签分离。
- 标签映射：`en` → 英语 / 英中字幕，`ja` → 日语 / 日中字幕，`ko` → 韩语 / 韩中字幕，`zh` → 中文 / 双语字幕，未知或空语言 → 原文 / 双语字幕；缺省组件参数沿用日语，以兼容旧调用。
- 语言代码支持大小写、空格及地区后缀，如 `EN-us`、`ja_JP`。无字幕模式不随语言变化。
- 本地浏览器已覆盖上述语言与回退情况，以及原文 / 双语 / 关闭显示；TypeScript、Vite 构建、播放器 ESLint 和语法浮窗交互回归通过。
- 本次仅更新前端源码和构建产物，无需重建后端。AI 语法提示词仍针对日语，英语语法解析尚需后续适配。

## 后续可继续做

- 用户在部署后的“AI 设置”填写自己的 DeepSeek Key，测试连接并保存，再用真实视频台词验证分析质量。
- 目前单密码登录，所有已登录用户共享服务器的 AI 设置；如改为多用户，需要为设置、缓存和配额增加用户隔离。
- 如需调整语法讲解风格或 JSON 结构，修改 `SYSTEM_PROMPT` 后同步增加 `PROMPT_VERSION`，避免复用旧分析缓存。
- 可添加相邻字幕上下文以改善歧义理解；若实现，必须让上下文参与缓存键。
