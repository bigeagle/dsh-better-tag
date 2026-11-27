<p align="center">
  <img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/banner.png" alt="dsh-better-tag：给会话贴扁平标签，落一枚持久的完成章" width="100%">
</p>

<h1 align="center">dsh-better-tag</h1>

<p align="center">给 <b>DeepSeek Harness</b> 的会话贴扁平标签，并落一枚持久的「完成」章。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-better-tag"><img alt="npm" src="https://img.shields.io/npm/v/dsh-better-tag?color=7c9cff"></a>
  <a href="https://www.npmjs.com/package/dsh-better-tag"><img alt="npm downloads" src="https://img.shields.io/npm/dw/dsh-better-tag?color=67c98a"></a>
  <a href="https://github.com/Diomchen/dsh-better-tag/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Diomchen/dsh-better-tag/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/Diomchen/dsh-better-tag?color=f0a35e"></a>
  <img alt="DSH 0.2.x" src="https://img.shields.io/badge/DSH-0.2.x-1b1d24">
</p>

---

DSH 原生的状态点回答的是「AI 交回了没有」：待你、交回未读、进行中、空闲。它不回答**这件事做完了没有**——因为只有你知道。

`dsh-better-tag` 补上这一层：标签说明这件事**属于什么**，「完成」章说明它**已经收尾**。两者都跟着会话走，重启后还在，发新消息时完成章自动解除。

**0.2 起，标签库按 workspace 管理**：每个 workspace 有自己的一套标签，互不干扰；升级时原全局库会自动复制成每个 workspace 的初始词表。每个 workspace 还可以单独打开 **Agent 标签工具**——开启后，这个 workspace 里的会话会获得 `session_tags_library_list` / `session_tags_library_update` / `session_tags_get` / `session_tags_set` 四个模型工具，AI 可以自主查看和维护标签库、给自己的会话打标（不在库里的名字自动建标签）；没开启的 workspace，模型根本看不到这些工具。

## 一眼看懂

| 位置 | 你会看到 |
| --- | --- |
| 侧栏行尾 | 最多 2 枚标签 + `+N`，排在时间之前；只读，不抢原生按钮 |
| 行悬停 | 原生 hover 卡片里显示该会话的全部标签与完成章 |
| 行悬停 / `…` 菜单 | ✓ 落章、取消章；「标签…」打开选择器（触屏兜底） |
| 会话标题旁 | 最多 3 枚标签 + `+N`；点芯片或「+ 标签」直接增删 |
| 侧栏「会话总览」 | 按 workspace 分组（可折叠，折叠状态跨刷新保留）：状态计数、每个分组内自己的标签筛选、归档开关、点行进入会话；有待处理会话的工作区自动置顶 |
| 标签选择器 | 搜索/新建合一、勾选/取消、每行色点就地改色、管理标签、**临时标签**（不入标签库，随会话持久化） |
| 管理标签 | 按 workspace 管理标签库：搜索、改名、色点改色、删除（级联移除所有引用）、导入/导出标签包、**Agent 标签工具开关** |
| Agent 标签工具 | 每个 workspace 单独开关；开启后该 workspace 的会话获得 `session_tags_library_list` / `session_tags_library_update` / `session_tags_get` / `session_tags_set`，AI 可自主管理标签并给当前会话打标 |
| 标签包 | 按 workspace 导出 JSON 分享；导入按名字合并，冲突保留本地并报告 |

**不做**：存量批量回填、维度/单选规则、自动归档、多窗口实时推送。

## 截图

> 标「实机」的图来自真实 DSH 窗口；其余为**示例数据**渲染，使用与插件相同的样式和组件结构，方便一次看全功能。

### 侧栏与标题旁（实机）

**侧栏行尾**：标签排在时间之前，最多 2 枚，多出来的收成 `+N`。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/row-order.png" alt="侧栏行尾：产品、DSH 两枚标签 +1，排在时间之前" width="720">

**标题旁**：打开会话后，标签在标题右侧；点芯片或「+ 标签」即可增删。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/header-tags.png" alt="会话标题旁的三枚标签与 + 标签按钮" width="1000">

### 悬停、完成章与行菜单（示例数据）

行悬停时显示全部标签（含临时标签）与完成章；行尾 ✓ 落章/取消，「…」菜单里还有「标签…」「取消完成章」「清除临时标签」。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/sidebar-hover.png" alt="侧栏行悬停：全部标签、完成章与落章操作" width="860">

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/row-menu.png" alt="会话行 … 菜单：标签、取消完成章、清除临时标签" width="560">

### 会话总览（示例数据）

按 workspace 分组：状态计数（待你 / AI 已交回 / 进行中 / 已完成 / 共）、显示归档开关，点行直接进入会话；组间按组内最紧急的会话排序，有待你 / 交回会话的工作区浮在最上面。点组头折叠/展开（折叠状态跨刷新保留）；每个分组有自己的标签筛选行，只筛本工作区的会话，多个工作区可以同时各筛各的；右上角进入管理标签。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/overview.png" alt="会话总览：状态计数、标签筛选、归档开关与会话列表" width="1000">

### 标签选择器与临时标签（示例数据）

顶部只有一个输入框：输入即筛，没有同名标签时出现「新建『x』」；勾选/取消，每行右侧色点就地展开 12 色板 +「随机」，不用离开当前会话。新建标签默认挑当前用得最少的颜色，不会都挤在第一格蓝。**临时标签**只挂当前会话，可「固定」进标签库或移除；底部入口进入管理标签。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/picker.png" alt="标签选择器：搜索/新建合一的输入框、库标签勾选、每行色点改色、临时标签和管理入口" width="820">

### 管理标签（示例数据）

管理器顶部先选 workspace，标签库、导入/导出和 Agent 工具开关都作用于选中的 workspace。标签到 8 个以上才出现搜索，从选择器点进来会带上刚才的查询和对应 workspace；改名、用色点浮层改色、删除；删除会级联移除所有会话上的引用。打开「允许 Agent 管理标签」后，这个 workspace 的会话在下一次对话就能使用四个标签工具。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/manage.png" alt="管理标签：标签多时的搜索、色点改色与删除" width="820">

### 标签包（示例数据）

粘贴 JSON 或选择文件导入；导入按名字合并进选中 workspace 的标签库，并报告新增 / 跳过 / 冲突。导出在管理器底部，直接下载该 workspace 的 JSON。

<img src="https://raw.githubusercontent.com/Diomchen/dsh-better-tag/main/docs/screenshots/pack.png" alt="导入标签包：JSON 文本、选择文件和导入结果报告" width="820">

## 安装

**DSH Desktop**：打开 **Settings → Plugins**，搜索 `dsh-better-tag` 安装，然后刷新页面。

**`dsh web` / 其他 profile**：

```sh
dsh plugin --profile web add dsh-better-tag
# 装完重启 dsh web
```

**直接从 GitHub 安装**（还没发版时）：

```sh
dsh plugin --profile web add github:Diomchen/dsh-better-tag
```

把 `web` 换成你实际的 profile 名。安装后不需要构建：包内是纯 ESM，零运行时依赖。

## 用法

1. **贴标签**：悬停会话行，点「…」→「标签…」；或打开会话，点标题旁的「+ 标签」。顶部输入框既能搜索也能新建；每行色点直接改色，新建标签会自动分到一个不挤的颜色。每个 workspace 有自己的标签库，选择器只显示当前会话所在 workspace 的词表。
2. **落完成章**：悬停会话行点 ✓，或「…」菜单里选「落完成章」。它会一直留着，直到你发下一条消息或手动取消。
3. **找回来**：点侧栏的「会话总览」，按「待你 / AI 已交回 / 进行中 / 已完成」计数看全局；按 workspace 分组的标签筛选，勾「显示归档」把归档会话也拉出来。
4. **让 AI 自己管标签**：总览 →「管理标签」→ 选中 workspace → 打开「允许 Agent 管理标签」。之后这个 workspace 里的会话就能用 `session_tags_library_list`（看标签库）、`session_tags_library_update`（建/改名/改色/删库标签）、`session_tags_get`（看本会话已贴的标签）、`session_tags_set`（给本会话打标，名字不在库里会自动建）。关掉开关，工具立刻从模型视野里消失。
5. **分享一套标签**：管理器 →「导出标签包」；别人在选中 workspace 后「导入标签包」，按名字合并，同名不同色会保留本地颜色并报告冲突。
6. **随手记**：选择器里可以打**临时标签**——不入标签库、跟着这条会话存；常用的话点「固定」收进标签库。

## 它怎么工作

- **Host 半边**把每个 workspace 的标签库与会话记录写成 `~/.dsh/storages/better-tag/state.json`（尊重 `DSH_HOME`），原子写、串行化，不写会话日志。0.1 的全局库在首次读取时迁移为「种子」，每个 workspace 的库在第一次被触及时从种子复制起步，之后各自演化。
- **Client 半边**通过同源接口 `/dsh-better-tag/v1/*` 读写；每次落盘变更（包括 Agent 工具写入）都通过长轮询变更通道实时推送到所有打开的页面（对会缓冲流式响应的代理也可靠），无需手动刷新。
- **Agent 标签工具**按 workspace 开关：开启时，工具注册到该 workspace 每个存活 agent 的 scoped context 上（`agent.ctx.tools.register`），agent 销毁自动卸载；没开启的 workspace 的 agent 从系统提示到执行管线都看不到这四个工具。
- **完成章**监听 `api-session/activity`：会话出现新用户消息时自动解除。
- **fork**：子会话继承父会话的标签（含临时标签），不继承完成章。优先包 `sessionController.fork`，并以 `session/created` 事件兜底。

## 数据与隐私

- 数据只在本机：`~/.dsh/storages/better-tag/state.json`（或 `$DSH_HOME/storages/better-tag/state.json`）。
- 接口由 DSH web server 的浏览器认证（会话 cookie）保护，本机与受信远程访问（如隧道/反代后的 GUI）都可用；所有写请求必须带自定义请求头 `x-better-tag: 1`，跨站页面无法在不触发预检的情况下伪造。
- 不发网络请求、不读会话正文，也不改会话日志。Agent 标签工具只在对应 workspace 开启后注册；工具调用与其他模型工具一样记录在会话日志里。
- 删掉插件不会自动删数据；要清空就删上面那个目录。

## 兼容性

- DSH Web / Desktop **0.2.x**；0.2.0 起在 **0.2.3-alpha.2** 上开发和验证（0.1.x 在 0.2.2-rc.3 上验证）。
- Node.js **>= 22**；零运行时依赖、无构建步骤。
- 支持中英文界面（跟随 DSH 语言设置）。

## 开发

```sh
npm test        # 33 个宿主测试（store / HTTP / activation）
npm run check   # node --check 全部源文件
npm pack --dry-run   # 看会发出去的包内容
```

发布走 tag：`v*` tag 会触发 GitHub Actions —— 跑测试、建 GitHub Release（附 tarball）、`npm publish`。流程和 Trusted Publishing 迁移见 [docs/RELEASING.md](docs/RELEASING.md)。

## 已知边界

- 侧栏行尾是原生的「悬停即隐藏」装饰位：鼠标停在行上时，标签会让位给操作按钮，这是原生行为。
- 标题旁插槽在窄窗口会被裁切，3 + `+N` 的上限可能需要按你的窗口宽度微调。
- 标签变化通过长轮询实时推送；推送中断时退化为窗口重新聚焦时重拉。
- 会话从一个 workspace 挪到另一个 workspace 后，原库标签 id 在新库解析不到就不显示（迁移种子的同 id 副本除外）；临时标签跟着会话走，不受影响。
- 数据只在本机，不含跨设备 / 多人同步。

## English

**dsh-better-tag** puts flat tags on DeepSeek Harness sessions and adds a persistent *done* stamp that only you can set.

- Per-workspace tag libraries: every workspace owns its vocabulary; an upgraded 0.1 global library seeds each workspace's starting copy.
- Opt-in agent tag tools per workspace: flip the switch and sessions there get `session_tags_library_list` / `session_tags_library_update` / `session_tags_get` / `session_tags_set`, so the agent can read the library, maintain it, and tag its own session (unknown names auto-create). Workspaces without the switch never see the tools.
- Tags in the sidebar row (before the timestamp), in the native hover card, and beside the session title.
- A done stamp that survives restarts and clears itself when you send the next message.
- A **session overview** grouped by workspace — collapsible groups (state survives reloads), the group with the most urgent session floats to the top — with status counts, a tag filter inside each group, and an archive toggle.
- Temporary per-session tags, named tag packs (JSON export/import per workspace), and tag management with cascade delete.
- Live sync: every change — including agent tool writes — reaches all open pages through a long-poll change feed, no refresh needed.

Install with `dsh plugin --profile web add dsh-better-tag` (or from **Settings → Plugins** in DSH Desktop), then restart `dsh web`. Data stays on this machine in `~/.dsh/storages/better-tag/state.json`; the plugin makes no network requests and never writes session logs. The API follows the web server's own authentication, so remote access through a trusted proxy works like loopback. Tested on DSH 0.2.x, Node.js >= 22, MIT licensed.

## License

[MIT](LICENSE) © 2026 Diomchen
