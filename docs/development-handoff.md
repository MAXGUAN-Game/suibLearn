# SubLearn 开发交接（2026-11-11）

## 最新追加：空格播放与暂停（2026-11-11）

- 播放页面增加 `Space` 切换播放／暂停，与播放器按钮共用操作及独立音轨同步逻辑，画面内显示短暂反馈；长按空格不连续切换，处理后阻止页面滚动。
- 普通、原生全屏与窗口铺满模式均可用。鼠标点击全屏按钮后将焦点移至播放器容器，随后按空格可直接控制播放；键盘聚焦按钮或链接时保留原生空格行为，避免一次按键触发两次切换。输入框、可编辑内容、弹窗、菜单及组合键沿用快捷键隔离规则。
- 播放请求失败时显示提示并保持真实暂停状态，拒绝的播放 Promise 会被处理；暂停仍沿用既有进度保存流程。此次仅修改前端。
- 本地 TypeScript／Vite 构建、修改文件 ESLint 通过；Chrome 实测空格播放／暂停、暂停保存进度、长按仅切换一次、按钮原生空格不双触发、鼠标进入全屏后直接按空格、键盘全屏按钮原生操作、窗口回退、输入框／可编辑内容／弹窗／菜单／组合键隔离、播放 Promise 拒绝提示及不滚动页面通过。既有方向键和语法弹窗浏览器回归通过，未发现运行时错误。
- 生产发布结果将在本节补充。

## 追加：方向键控制进度与音量（2026-11-11）

- 键盘 `← / →` 后退／前进 5 秒，`↑ / ↓` 增大／减小音量 10 个百分点；画面内短暂显示操作结果。普通、原生全屏和窗口铺满模式使用同一套控制。
- 进度限制在 0 到媒体时长之间，跳转同步当前字幕、高亮、独立音轨与观看书签，保持当前播放／暂停状态；跳出 AB 循环的 `[a,b)` 区间时清除循环，避免下一帧回跳。
- 音量限制为 0–100%，静音后可用向上键恢复。最后音量保存在当前浏览器 `sublearn_player_volume_v1`，刷新或切集继续使用；该值不写服务器播放设置。禁用浏览器存储时仍可操作。
- 组合键、文字输入区、可编辑内容、打开的语法／AI 设置浮窗及播放器菜单不触发播放快捷键；已处理的方向键阻止页面跟随滚动。
- 此次仅修改前端，无新增数据库字段或后端依赖。本地 TypeScript／Vite 构建、修改文件 ESLint、既有 16 项状态／字幕测试通过；Chrome 实测方向键步长、播放／暂停状态保持、字幕同步与进度保存、首尾及音量边界、音量刷新恢复、零音量恢复和解除静音、原生全屏及窗口回退、输入框／浮窗／菜单／组合键隔离、跳出 AB 循环与阻止页面滚动通过。原有全屏／字幕栏、观看记忆／离线恢复和语法浮窗浏览器回归通过，未发现运行时错误。
- 已发布功能提交 `66140a3`。生产 Chrome 使用《孤独的美食家》首集真实媒体完成上述方向键、全屏、音量与输入隔离用例，全部通过，健康检查正常；台词／AI 响应／播放设置／书签接口使用浏览器夹具，未改写用户观看进度，也未新增 DeepSeek 调用。
- 生产测试隔离注意：仅使用 Playwright 路由模拟写入不足以覆盖页面关闭时的 keepalive 请求。首轮关闭浏览器产生了该首集的临时测试书签；核对完整 Nginx 日志确认该集自播放记忆上线后只有自动测试写入，已按准确时间戳／位置条件清理，其他书签保持完整。清理前备份 `/app/data/backups/before-keyboard-qa-cleanup-20261111T133508Z.db`。复测在页面 `fetch` 层直接模拟所有播放 PUT，全部用例通过，数据库与访问日志确认关闭后没有真实写入。后续生产夹具测试应沿用此隔离方式。
- 发布前备份：`/opt/sublearn-releases/20261111T133154Z-before-keyboard-controls/frontend-before.tar.gz`。仅更新前端静态产物与 Git 源码并重新加载 Nginx，后端镜像及服务器本地 Nginx 配置保持原样。

## 追加：全屏播放器与字幕栏收拢（2026-11-11）

- 播放器右下角新增“全屏 / 退出全屏”按钮。全屏对象为整个播放器容器，包含自定义字幕、播放控制和语法解析；字幕位于画面底部，控制栏上方。继续使用既有日语／日中／无字幕模式，不因切换全屏改变播放位置、倍速或暂停状态。
- 原生 Fullscreen API 的进入／退出事件同步按钮状态；不支持或请求被拒绝时使用窗口铺满模式，保留自定义字幕，支持退出按钮和 Esc。
- 右侧字幕栏标题处新增“收拢”，收起后显示窄边栏“展开字幕”按钮，播放器获得更多宽度；手机布局对应为横向展开条。收拢状态仅保存在当前浏览器 `sublearn_subtitles_collapsed_v1`，不会改写服务器播放设置。
- 展开后重新定位当前台词，只滚动字幕列表自身，避免字幕跟随滚动把播放器推离视口。收拢／展开后键盘焦点跟随到对应按钮。
- 此次为前端静态资源更新，无数据库迁移或后端依赖变更。既有服务器视频、字幕、AI 配置与观看记录沿用原数据。
- 本地验证：TypeScript／Vite 构建、修改文件 ESLint 和既有 16 项播放器状态／字幕选择测试通过。Chrome 原生全屏、字幕底部位置、控制栏和两类浮窗可见性、解析失败后打开 AI 设置、原生退出事件同步、全屏请求拒绝后的窗口回退、字幕栏收拢／展开与刷新记忆、390px 手机布局通过；观看进度／离线恢复及语法弹窗浏览器回归通过，未发现运行时错误。浏览器中的 AI 响应使用既有真实响应夹具模拟，没有额外调用 DeepSeek。
- 已发布功能提交 `fa0f328`。生产 Chrome 使用《孤独的美食家》首集真实媒体解码，验证原生全屏、字幕位置、两类浮窗、错误后打开设置、退出同步、请求拒绝回退、侧栏刷新记忆与手机布局，全部通过；用例中的台词、AI 响应、播放设置与书签 API 使用浏览器夹具，避免修改用户的实际观看记录或消耗 AI 请求。未发现运行时错误，健康检查正常。
- 发布前静态资源与服务器 Nginx 配置备份：`/opt/sublearn-releases/20261111T132245Z-before-fullscreen-sidebar/frontend-before.tar.gz`。此次只更新 Git 源码／前端产物并重新加载 Nginx；后端运行镜像保持原样，服务器本地 `nginx.conf` 修改保留。

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
node --experimental-strip-types --test tests/subtitleSelection.test.ts
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
- 该次标签修复仅更新前端源码和构建产物，无需重建后端；当时 AI 语法提示词仍针对日语，后续适配见下节。

## 追加：英文解析失败的定位与修复（2026-11-11）

- 真实生产复现截图句子 `I've wanted to tell her off for the last six weeks.`。DeepSeek 接口和密钥正常，返回 JSON 的 `sentence` 与原句一致，但各分段丢掉了短语之间的三个空格，拼接成为 `I'vewantedto tell her offfor the last six weeks.`，触发原有逐字校验而返回 502。
- `grammar.py` 现在按原句游标顺序逐段匹配，仅将原句中缺失的分段边界空白补回；修复后仍强制要求所有分段拼接逐字等于原句。不会修复或放过缺词、错字、标点改写、片段内部空格变化和乱序。
- 提示词改为识别原句语言，支持英语与日语：英语讲解时态、从句、不定式和短语动词，日语讲解活用、助词和句型。`PROMPT_VERSION` 更新为 `sentence-grammar-v2`，隔离旧提示词缓存。
- 流式响应的 `finish_reason=length` 单独识别，向用户提示输出截断；日志仅记录固定的失败原因码，不记录原文、模型全文、URL 或 Key。
- 未增加额外的上游重试。前端合同保持不变，不需要重新构建前端；上线须更新并重新启动后端镜像。
- 32 项后端测试通过，新增覆盖截图英文句、缓存中的完整空格、首尾空白、多空格和换行、部分已保留空格、重复词、缺字/改标点拒绝、截断结果不入缓存及日志脱敏。

## 追加：重叠注释抢占台词的修复（2026-11-11）

- 第一集 `03:33.72–03:41.63` 的仅译文注释 `[Cream Puffs 意为泡芙或者娘娘腔]` 与随后三句台词重叠。旧实现用首个时间命中项并包含结束时刻，导致点击 `03:37.13`、`03:37.97`、`03:39.87` 的台词后，高亮/自动滚动回注释，原文模式中字幕为空。
- 新增共享选择函数 `frontend/src/utils/subtitleSelection.ts`：使用 `[start, end)`；重叠时优先有非空原文的台词，同类选起点最新的条目，同起点稳定保留首项；没有台词时仍保留仅译文内容作为兜底。没有删除注释或改写既有字幕数据。
- 播放器字幕、右侧高亮与自动滚动、逐句暂停、解析按钮取句均使用同一个函数。外部点句和点击进度条跳转会立即同步播放时间与字幕状态，暂停时也能正确更新。
- 新增 `frontend/tests/subtitleSelection.test.ts` 的 9 项 Node 原生测试，涵盖真实重叠时间、句末边界、乱序输入、同类重叠、仅译文兜底、空白条目和间隙；不新增依赖。
- 浏览器以真实时间范围的媒体夹具逐一验证三句点击、精确跳转、正确高亮、原文字幕显示、连续播放跨句、逐句模式暂停；解析请求的目标台词通过本地模拟响应验证。TypeScript、Vite 构建和相关文件 ESLint 均通过。
- 本次只需发布前端源码与 `dist`，无需重建后端，也无需重新上传第一集。复查现有第一集 `03:37–03:42` 即可。

## 后续可继续做

- 最初发布时用户尚未配置 Key；此次英文错误定位时已确认生产 DeepSeek 配置可调用。后续可继续抽查实际视频台词的语法讲解质量。
- 目前单密码登录，所有已登录用户共享服务器的 AI 设置；如改为多用户，需要为设置、缓存和配额增加用户隔离。
- 如需调整语法讲解风格或 JSON 结构，修改 `SYSTEM_PROMPT` 后同步增加 `PROMPT_VERSION`，避免复用旧分析缓存。
- 可添加相邻字幕上下文以改善歧义理解；若实现，必须让上下文参与缓存键。

## 追加：空白片段解析修复与观看记忆（2026-11-11）

- 真实复现「何よ 偉そうに」连续三次失败：DeepSeek 将中间空格单独输出成 segment，却把 `structure/role` 留空，触发 `invalid_schema; kinds=length`。新增确定性归一化：先校验原始片段和注音词块逐字重建，再把纯空白段并入相邻有效片段。输出仍保留每个空格、换行和制表符；实词缺字段、改字、漏字或不合格读音仍拒绝，不增加 AI 重试。实际故障响应作为固定回归 fixture 保存。
- 播放器保存字幕模式、倍速和逐句暂停开关；每个视频独立保存观看位置。再次打开会等媒体元数据就绪后定位，保持暂停；显式点击字幕／进度条可覆盖恢复位置。初始 seek 尚未真正完成时，不会把临时的零秒写回书签，首次解码帧就绪后可重试定位。
- 配置和进度保存在服务器 SQLite 新表 `playback_settings`、`playback_progress`，当前单密码共享账户可跨浏览器／设备恢复。两个新表独立于 AI 配置；进度外键随视频删除级联清理。
- 鉴权 API：`GET/PUT /api/playback/settings`，配置字段 `speed/subtitle_mode/sentence_mode`，PUT 支持部分更新；`GET/PUT /api/playback/progress/{video_id}`，字段 `position/duration`。返回 `updated_at` 为 epoch 毫秒；无书签为 `0/0/0`，写进度要求有限数值且 `0 <= position <= duration`、`duration > 0`。
- 浏览器 `sublearn_player_settings_v1`、`sublearn_watch_progress_v1` 作为本地兜底，以时间戳协调服务器与较新的离线记录；本地最多保留 200 集，服务器书签不受此限制。播放期间本地最多每秒写入一次，服务器最多每 5 秒同步一次；暂停、跳转、隐藏、退出时刷新最新位置，网络恢复后重试待同步数据。排队请求合并为最新值，旧页面迟到响应不覆盖新视频状态。
- 代码入口：`frontend/src/hooks/usePlaybackState.ts`、`services/playbackPersistence.ts`、`utils/playerState.ts`；后端 `routers/playback.py` 与 `models/database.py`。没有旧进度可迁移，新记忆从本次更新后开始记录。
- 本地及服务器候选镜像的 66 项后端测试通过；16 项前端工具测试、TypeScript/Vite 构建与修改文件 ESLint 通过。浏览器使用可 Range 跳转的媒体夹具验证刷新、暂停刷新、每集独立书签、跨浏览器读取、离线兜底与重连、切换路由时旧请求隔离；现有解析浮窗交互回归通过。
- 功能提交 `1e881ff` 已上线，镜像 `sublearn-backend:memory-1e881ff8`。对截图原句连续发起三次新的真实 DeepSeek 请求，均通过归一化和逐字校验；生产浏览器显示两个有效片段「何よ 」「偉そうに」，汉字读音、成分及词义正常，手机无横向溢出。
- 生产浏览器使用真实《孤独的美食家》首集验证 73.25 秒恢复、修改为 91.5 秒后刷新恢复、全新浏览器上下文恢复，以及字幕模式／1.25 倍速／逐句暂停的服务器持久化。测试结束后按条件恢复测试前的设置和书签，未留下测试位置。原 39 个视频、16215 行字幕、4 个合集及 AI 设置完整记录差集校验通过，健康检查正常。
- 发布前源码和前端备份：`/opt/sublearn-releases/20261111T131147Z-before-playback-memory/source-before.tar.gz`；数据库备份：`/app/data/backups/before-memory-20261111T131147Z.db`；旧镜像：`sublearn-backend:before-memory-20261111T131147Z`。应用回滚时保留新增播放表和观看记录；原视频不需要重新上传。

## 追加：句子结构、汉字读音与词义（2026-11-11）

- 语法浮窗顶部的彩色片段下方显示句子成分标签，如主语、谓语、宾语、定语从句；与下方的词性／活用标签分开。日语省略成分在整句说明解释，不强行补出不存在的主谓宾。
- 原句及下方词条使用 HTML `ruby/rt` 在汉字上方标注平假名；汉字与送假名尽量拆开，只给汉字部分注音。英文、假名和标点不加读音。
- 语法拆解中新增独立“词义”行，给出单词或短语在当前语境的中文意思；无独立词义的助词／标点可不显示。
- `POST /api/analysis/grammar` 的每个 segment 新增必填 `structure: string`、`meaning: string`、`reading_tokens: [{text, reading}]`，保留 `text/role/explanation`。词块拼接必须逐字等于 segment.text，片段拼接必须逐字等于 sentence；两层只允许恢复原文遗漏的边界空白，不修复错字或漏词。汉字词块必须有平假名读音，拒绝片假名、罗马字和缺失读音。
- `PROMPT_VERSION=sentence-grammar-v4`；前端缓存键同步升级，旧解析会重新生成，不需要删除视频或字幕。增加输出预算到 8192，保留超时、并发合并、失败不缓存及日志脱敏。
- 提示词明确名词不自动等于宾语，并提供截图实句的完整示例：「器用な」定语、「もん」谓语中心语、「だ」判断谓语、「な」语气成分；对日语连体修饰从句标出层级。模型返回的无害附加属性会被忽略且不进入响应／缓存，缺少必填或改变原文／读音的结果仍被拒绝。格式诊断日志仅记录固定错误分类。
- 本地及服务器候选镜像的 49 项后端测试通过；9 项字幕选择测试、TypeScript/Vite 构建与修改文件 ESLint 通过。浏览器模拟响应覆盖截图实句、成分标签、上下两处注音、词义、原句不变、手机宽度、加载失败重试及原有交互。
- 已发布功能提交 `9447883`，候选／运行镜像 `sublearn-backend:structure-9447883e`，线上健康检查正常。真实 DeepSeek 核验了截图句「器用なもんだな」、英文定语从句、日文连体修饰从句及《孤独的美食家》首集实际台词；截图句不再把「もん」误标为宾语。
- 生产浏览器直接调用真实解析 API，检查顶部成分标签、`器用 → きよう`、下方中文词义、原句逐字不变；1600px 桌面及 390px 手机无横向溢出。真实首集播放、跳转及汉字注音正常，浏览器无运行时错误。
- 完整记录差集校验通过：39 个视频、16215 行字幕、4 个合集及 AI 配置保持不变；只新增解析缓存。发布前源码／前端备份在 `/opt/sublearn-releases/20261111T124813Z-before-structure-ruby/source-before.tar.gz`，数据库一致性备份在 `/app/data/backups/before-structure-20261111T124813Z.db`，旧镜像标签 `sublearn-backend:before-structure-20261111T124813Z`。增量镜像不增加依赖，未修改服务器 Nginx 的本地域名配置。

## 追加：两部日剧字幕与首集测试（2026-11-11）

- 《孤独的美食家》第一季 12 集：从内封轨提取原始日文、简中和繁中，生成日中 ASS；全季 3378 条，其中 2850 组日中配对。
- 《深夜食堂》2009 日版第一季 10 集：原视频无字幕轨，已有外挂为中文；补充 NF 日文字幕，逐集校时后生成日中 ASS；全季 2086 条，其中 1785 组日中配对。第 10 集使用线性锚点处理轻微累计差异。
- 原 MKV 和原字幕保留。所有上传用 ASS 位于各自本地源目录的 `提取字幕/SubLearn上传用/`，详细来源、输出目录、时间校正和原字幕限制见 [日剧字幕处理记录](japanese-season-subtitles.md)。
- 本次仅上传各自第一集，未上传整季视频。创建两个日语合集，未更改应用代码或重新部署容器。

| 剧集 | 首集播放器 | 合集 ID | 线上首集规格／字幕 |
| --- | --- | --- | --- |
| 孤独的美食家 | [首集](http://118.178.178.123/learn/395b1ca1-a48f-41f8-85d0-61c1bf8a4dc9) | `14acf1ed-abe5-41d3-a853-73874fe562de` | 1920×1080 H.264/AAC，1438.016 秒；258 条、224 组日中配对 |
| 深夜食堂 | [首集](http://118.178.178.123/learn/335b3a1a-e414-4a0c-98b8-59b8e1c04549) | `25245fa1-4769-4d1c-a7bd-981a6f0e9ec8` | 1280×720 H.264/AAC，1476.98 秒；198 条、179 组日中配对 |

- 两集均通过服务器文件 SHA256、生产字幕解析、API ready、媒体 Range 请求和真实 Chrome 播放验证；片中及后段跳转正常。
- 网页已分别验证“日语 / 日中字幕 / 无字幕”；字幕关闭后的正文抽查画面没有烧录对白字幕。
- 实际点击“解析”并调用当前生产 DeepSeek 配置：两集均返回有效彩色分段，分段拼接逐字等于当前日文台词；浏览器无运行时错误。此次未使用模拟 AI 响应。
- 入库前在线一致性备份：`/app/data/backups/before-japanese-pilots-20261111T121637Z.db`。以该备份做完整记录差集校验通过，原有 21 个视频、7961 行字幕、2 个合集的完整记录均保留。
- 两处本地 `上传测试用/上传测试结果.json` 保存对应首集媒体哈希、线上 ID 和浏览器测试结果；媒体与凭证不进入 Git。

## 追加：摩登家庭第一季整季上传（2026-11-11）

- 已向原英语合集“摩登家庭 · 第一季”补齐 E02–E24，共 24 集；合集 ID `0bfa8a2e-b780-4a91-9974-02b7ead1b020`，封面与 E01 保持原样。
- [合集](http://118.178.178.123/collection/0bfa8a2e-b780-4a91-9974-02b7ead1b020)；完整集号、视频 ID、大小、时长、SHA256 和字幕数量见 [整季导入清单](modern-family-season01-import.json)。共 11670 条字幕、11570 组英中配对，视频合计 20.29 GiB。
- 本地原 MKV 全部保留。新增集数转码为 1080p H.264/AAC 双声道 MP4（NVENC p5、CQ23、最大视频码率 6 Mbps、yuv420p、faststart），不烧录字幕；使用此前提取并验证的 `SubLearn上传用/*.英中双语.ass`。
- 批量导入前使用 SQLite 在线备份 API 建立一致性备份，路径记录在清单中，备份文件权限 0600。没有调整 AI 设置、删除原视频或重启应用。
- 为避免普通 HTTP 上传将大文件整体读入后端内存，使用 SFTP 写入现有 media-data 卷；固定 UUID、按集加锁、`.part` 断点续传并原子改名。每集在生产容器内验证 MP4/字幕 SHA256、用现有解析器核对英中配对后，调用现有数据库服务登记并标记 ready。路径沿用 `sublearn/media/<uuid>/video.mp4` 与 `subtitle.ass`。
- 新增 23 集均检查 API 元数据、字幕数量、媒体 HTTP 206 Range，并在 Chrome 实际解码播放、跳转到字幕时间、核对英中字幕；E02/E13/E24 另检查英语与无字幕模式。合集页面确认 24 集与原封面，浏览器无运行时错误。临时脚本、转码视频、鉴权令牌不提交 Git。
- 本地断点记录和浏览器检查结果位于 `C:\BaiduNetdiskDownload\第 1 季 - 1080p BluRay x265 10bit\SubLearn整季上传`。服务器媒体已持久化；在另一台电脑拉取 Git 后直接使用现有服务器，无需重新上传。
