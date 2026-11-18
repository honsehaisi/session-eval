# 系统测评 · 会话日志评测算分工具

**读会话日志 → 给八个维度打分 → 出一份单文件 HTML 报告。**
不绑定某个框架：只要把日志按「标准事件流」喂进来，任何写结构化日志的 AI 代理都能被体检。

> 对外介绍就一句：「会话日志的评测算分工具」。不用一上来讲「大肥鱼系统」。
>
> **公开版只含运行代码与使用文档**：内部计划、开发日志、本机证据不在本仓。拿到带 `internal/` 的完整开发副本时，请先读 [SECURITY.md](SECURITY.md)：受保护区域需要所有者密码，不要尝试绕过。

**示例结论（本机快照 2026-11-14 17:55，不是通用基准）**：
速度 B / 稳定 A / 成本 C / 交付 A / 安全 D / 记忆 B / 诚实 B → **综合 B（2.77）**；最低等级 **安全 D**；合格率 5/7。
别人的日志跑出来会是别的数，这行只是让你知道报告长什么样。

---

## 1. 它适不适合你

**适合**：你的工具/代理写结构化日志——每轮对话、每次工具调用、token 用量、审批、策略变更都有记录。

**不适合**：日志只有纯文本聊天、没有工具调用与 token 用量。硬跑不会报错，但成本/安全/稳定都会是空数（报告里会标「未覆盖」，不按 0 分罚）。

**这台机器上现在能跑**：DSH 的 `session.v4.jsonl.zstd`（多帧 zstd）。别的格式见 §5 写适配器。

---

## 2. 三分钟上手

前提：**Node ≥ 22.15**（多帧解压要用 `zlib.zstdDecompressSync`），**零依赖，不用 `npm install`**。

```bash
# 0) 可选：没有日志先造一份示例，把链路跑通
node scripts/make-sample.js                 # 写到 _work/demo-sessions（DSH 格式）
node scripts/make-sample.js --format generic  # 另造一份通用 JSONL 示例（_work/demo-generic）

# 1) 自检：配置读到了吗、日志目录存在吗、读到几份、能不能解码
node scripts/doctor.js

# 2) 出分（约 1–3 分钟，441 份日志约 110 秒）
node scripts/run-all.js

# 3) 生成可离线打开的报告页
node scripts/build-report.js                # → report/report.html

# 4) 口径自测（90 项，约 2 秒）
node --test tests/
```

> 也可以 `npm run doctor` / `npm run report` / `npm test`——`package.json` 里就是这几条，没有魔法。

**跑完先看两样东西**：`doctor` 的「会话数量」，和 `run-all` 第一行的「配置 / 实际会话目录」。
读到 0 条时报告也会出，但那是一张空表——先确认目录，再看分数。

---

## 3. 配置：换机器只改 `config.json`

读顺序：`SYSEVAL_CONFIG` 指定的文件 → 项目根 `config.json` → 内置默认。
模板见 `config.sample.json`；**`config.json` 是本机文件，不入库**。

| 字段 | 默认 | 说明 |
|---|---|---|
| `paths.sessionsDir` | `~/.dsh/sessions` | 日志根目录；DSH 的布局是 `sessions/<分组>/<会话>/session.v4.jsonl.zstd` |
| `paths.memoryDir` | `~/.memory` | 记忆库根目录（F1/F2 规则、路径归类用） |
| `paths.homeDir` | `~` | 「家目录」的判定基准（`~` 展开始终是**当前 OS 用户**，不是这个字段） |
| `paths.dshDir` | `~/.dsh` | DSH 配置目录（F4 规则：改配置要确认） |
| `paths.qbankFile` | 空 | 记忆题库快照；空 = 记忆维度没有本机证据（标「未覆盖」） |
| `paths.memoryEvidence` | 空 | 记忆维度证据文件（`report-offline.json` 结构）。空 = 未覆盖，不按 0 分罚 |
| `paths.speedEvidence` | 空 | 可选：覆盖速度证据文件。空 = 读 run-all 现算的 `src/tasks/report.json` |
| `paths.defaultCwd` | 空 | 日志里没写 cwd 时的兜底工作区 |
| `paths.dataSource` | `dsh` | 数据源适配器名：`dsh` 或 `generic`（通用 JSONL，见 §5） |
| `generic.*` | 最小格式 | 通用适配器的文件匹配与字段映射，见 §5.2；不配就是最小格式 |
| `paths.rulesFile` | `rules/safety.json` | 安全规则表；换一套规则不动代码 |
| `roots.extraWriteRoots` | `[]` | 额外允许写的根（私有项目盘等）；A1「写工作区外」会豁免这些目录 |

路径支持 `~` 和相对项目根（不是相对当前 cwd）；统一转成正斜杠，因为下游按 `/` 比较。
**目录不存在会大声警告**，不会静默读到 0 条。

想整体换一份配置（例如对比冻结日志）：`SYSEVAL_CONFIG=D:/tmp/cfg.json node scripts/run-all.js`。

---

## 4. 它读什么、写什么

- **只读日志**：不修改、不移动、不删除原始会话文件。
- **写**：`report.json`、`report/report.html`，以及各维度中间产物（`src/<维度>/*.json`）。
- **不发网络请求**：没有遥测、没有外链；`report.html` 单文件、离线可开。
- 报告里可能出现本机路径（命中详情会带路径），**外发前自己看一眼**。

---

## 5. 换数据源：先用通用格式，写不动再写适配器

两条路：
- **你的日志能导出成 JSONL** → 用现成的 `generic` 适配器，只改 `config.json`（§5.2）。
- **格式完全不是 JSONL**（二进制、数据库、私有串）→ 照 §5.3 写一个适配器。

### 5.1 最小格式：一行一步，六七个字段

速度 / 稳定 / 成本 / 交付这四维**只靠下面这些字段**就能算，不需要理解你的框架：

| 字段 | 必需 | 说明 |
|---|---|---|
| `t` | ✅ | 时间戳。ISO 字符串、毫秒、秒都认（`timeUnit` 可强指定） |
| `turn` | ✅ | 第几轮（整数，从 1 起）。速度要用「首行时间 → 末行时间」 |
| `tool` | 工具行 | 工具名；模型纯文本行不写它 |
| `args` | 可选 | 工具参数对象。交付维度要看路径/命令，最好给 |
| `ok` | ✅ | 这次调用有没有报错（`false` = 报错）。**不填 → T1 判不了，稳定维度不可信** |
| `in` / `out` | ✅ | 输入 / 输出 token。成本维度靠它 |
| `stop` | 可选 | 轮结束原因（`completed` / `aborted` / `interrupted` / `error`）。缺省记 `unknown`，不算异常 |
| `role` | 可选 | `user` / `assistant`，用来标用户消息与回复 |
| `text` | 可选 | 文本内容 |

一行样例（一轮三步：读 → 写 → 收尾）：

```jsonl
{"t":"2026-11-14T09:00:00Z","turn":1,"role":"user","text":"把报告生成一下"}
{"t":"2026-11-14T09:00:04Z","turn":1,"role":"assistant","tool":"Write","args":{"path":"a.md"},"ok":true,"in":1200,"out":180}
{"t":"2026-11-14T09:00:12Z","turn":1,"role":"assistant","text":"写好了","in":900,"out":40,"stop":"completed"}
```

**两个口子**：`stop` 只有「轮」的最后一行写；`ok` 只有工具行写。没有工具调用的纯聊天日志也能跑，但交付、稳定、安全会没有样本（报告标「未覆盖」，不按 0 罚）。

造一份最小格式的示例看看：`node scripts/make-sample.js --format generic`（写到 `_work/demo-generic`，并附一份只给示例用的 `config.json`）。

### 5.2 通用适配器：字段名不一样也能对

`paths.dataSource` 改成 `"generic"`，再按你的字段名填 `config.generic`（模板见 `config.sample.json`，每个字段都有 `_help`）：

```json
{
  "paths": { "sessionsDir": "D:/logs/agent", "dataSource": "generic" },
  "generic": {
    "fileGlob": "**/*.jsonl",
    "turns": "field",
    "sessionMode": "file",
    "productTools": ["Write", "Edit", "bash"],
    "fields": {
      "time": "ts", "turn": "conversation.turn",
      "tool": "call.name", "args": "call.args", "ok": "call.ok",
      "inputTokens": "usage.prompt_tokens", "outputTokens": "usage.completion_tokens",
      "stop": "finish", "text": "message.content", "role": "message.role"
    }
  }
}
```

| 配置项 | 取值 | 说明 |
|---|---|---|
| `fileGlob` | 默认 `**/*.jsonl` | 找哪些文件；支持 `*` `?` `**` |
| `timeUnit` | `auto` / `ms` / `s` / `iso` | 时间戳单位；`auto` 看量级猜 |
| `turns` | `field` / `infer` | 有 turn 字段用 `field`；没有就用 `infer`（按 user 行切轮） |
| `sessionMode` | `file` / `field` | 一文件一会话；或按 `session` 字段分组（一个文件混多个会话） |
| `productTools` | 数组 | **哪些工具算「产物动作」**。填你的工具名，如 `["Write","str_replace_editor","bash"]`；不填 → 交付维度只认内置工具名，多半是 0 |
| `fields.*` | 字符串 | 你的字段名；空字符串 = 日志里没这个字段；支持 `a.b` 点取嵌套 |

补字段的原则（配错了会「假绿」，比报错更坏）：
- `ok` / `error` 至少配一个，否则 T1 是空的 0%——`doctor` 的「数据源覆盖」会点出来；
- 缓存 token 不配就按 0 算，成本会**偏高**（不会偏低），可接受；
- `stop` 不配记 `unknown`，不数进异常率分母，不会冤枉你。

`doctor` 会多一项「数据源覆盖」，把工具/错误/token/turn/产物工具的实际映射打出来——**先看这一行再信分数**。它还会提醒：安全维度的 `dsh` 类规则依赖 DSH 的工具名与目录，换数据源后天然 0 命中，那是「没覆盖」不是「没问题」。

### 5.3 写自己的适配器

`core` 只认标准事件，DSH 日志长什么样只在 `src/adapters/dsh.js` 里。别的格式（Claude Code / Cursor / 自建）照这张表产出事件即可：

```json
{"sid":"…","origin":"main|subagent","t":1793859667301,
 "type":"usage|tool_call|tool_result|turn_start|turn_end",
 "turn":3,
 "usage":{"in":0,"out":0,"cacheRead":0,"cacheWrite":0},
 "tool":{"name":"ops_bash","args":{},"result":{}}}
```

实际字段（v1，见 `src/adapters/dsh.js` 顶部注释）：

| type | 关键字段 |
|---|---|
| `turn_start` / `turn_end` | `turn`、`seq`、`time` |
| `user_message` | `text`（DSH 的用户消息不带 turn，归属由 core 判） |
| `assistant_text` | `turn`、`step`、`texts`、`text` |
| `usage` | `turn`、`step`、`usage:{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}` |
| `tool_call` | `turn`、`step`、`callId`、`name`、`args`、`rawArgs` |
| `tool_result` | `turn`、`step`、`callId`、`text`、`isError` |
| `approval_asked` / `approval_decided` | `id`、`callId`、`tool`、`reason`、`outcome` |
| `policy` | `name`（`sandbox/mode` / `approval/policy` / `permission/preset`）、`data` |
| `command` | `name`、`args` |

适配器必须导出：

```js
module.exports = {
  // base = config.paths.sessionsDir；返回 [{ id, dir, meta:{createdAt,cwd,origin,parentSession,delegationDepth},
  //   events:[…], stats:{records,parseErr,latestTime,bytes} }]，解不开的给 { id, err }
  listSessions(base, opts),
  sourceGlob(),          // 报给报告用：这份目录按什么模式找会话
  parseSession(file),    // 可选：doctor 的「样本解码」会用它
  toEvents(records),     // 可选：同上
};
```

然后 `config.json` 里 `"dataSource": "your"`，`src/dataset.js` 里注册一行。
两个现成工具：

```bash
node scripts/export-events.js --limit 2      # 看标准事件流长什么样（眼验适配器）
node scripts/make-sample.js --out D:/tmp/demo  # 造一份 DSH 格式的示例日志
```

**写不动就交给 AI**：`docs/给AI的适配器施工单.md` 有一段可直接复制给 Claude Code / Cursor 的 prompt（接口契约 + 自检三连 + 常见坑），不用你自己对着 `dsh.js` 摸索。

**一个坑**：DSH 的会话文件是**多帧 zstd**（每追加一次写一帧）。Node 的 `zstdDecompressSync` 只解第一帧，会静默得到每份 180 字节的头。必须走 `src/zframes.js` 的 `decompressAll()`；`tests/zframes.test.js` 专盯这条。

### 改安全规则（`rules/safety.json`）

47 条规则（原 46 条 + 2026-11-12 补抽的 Z1）在 `rules/safety.json`，`src/safety/matcher.js` 只剩判定流程。

- 每条规则：`level`（红/确认/留痕/绿）、`tier`（T1/T2/T3 授权分类）、`title`、`target`（`generic` 通用 / `dsh` 依赖本系统专有工具名与目录）、`fires`（`false` = 只描述不判定）。
- 和机器有关的东西都在 `targets` / `protected` / `identity`：系统目录、DSH 配置与代码标记、工作区标记、人格页保护、QQ 主人 uid、密钥扫描目录与关键字。
- 判定用的正则全在 `patterns`；`_` 开头的字段是注释，不会被读。
- 改完依次：`node --test tests/`（表结构与正则语义有单测）→ `node src/safety/matcher.js`（看零命中清单）→ 用冻结日志跑 A/B（做法见 `docs/实测-S3-规则外置.md`）。

**静默 0 命中是这类外置最大的坑**：规则表读进来了但 target/路径判错，A1 会变成 0 次而不报错——所以 matcher 每次都打印「零命中 N 条」，`doctor` 也会打 generic/dsh 分布。


---

## 6. 八个维度、口径在哪

| 想知道 | 去哪 |
|---|---|
| **交给工程实现看这份** | `docs/计划书-交付.md`（交付版 v1.1：任务/验收/红线/测评规格） |
| 接入自己的日志（通用格式 / 让 AI 写适配器） | 本文件 §5 + `docs/给AI的适配器施工单.md` |
| 八维权重、四档线、综合算法（唯一口径） | `docs/计划书-交付.md` **§二 评分协议** |
| 每个维度的指标定义与实测 | `docs/计划书.md` §1–§8 |
| 可移植改造（S1–S5）进度与坑 | `docs/计划-可移植改造.md` |
| 一致性 T1 怎么跑 | `src/consistency/README.md` |
| 记忆断网复测 | `docs/记忆复测-断网-2026-11-12.md` |
| 上一轮一致性审查 | `docs/审查报告-2026-11-12.md` |
| 上一版计划（只作对照，已停维护） | `docs/计划v0-留档.md` |

**一条铁律**：0–4 分制唯一，A=4 B=3 C=2 D=1 E=0；不设百分制；权重只在计划书 §0.6 表登记一次；未出数的维度标「未覆盖」，不进 `min`、不按 E 罚。

哪些档是**这次跑出来的**、哪些是**仓库里带的固定产物**：

| 维度 | 来源 | 可移植性 |
|---|---|---|
| 稳定 / 成本 / 交付 / 安全 / 诚实 | 本次日志实时算 | ✅ 换目录就换数 |
| 速度 | run-all 每轮现算（`src/tasks/segment.js`：S1 = turn 内耗时全库中位，S2 = 任务段耗时中位） | ✅ 换目录就换数 |
| 记忆 | 题库**从被考者自己的记忆库生成**（`gen.js --auto` 出草稿 → 人工抽检）；分数走 `paths.memoryEvidence` | ⚠️ 只能测「自己的库」：拿别人的题库来跑，问的是别人的页面，答不出来也不该扣分 |
| 一致性 | T1 未复问（≥ 2026-11-19） | ⛔ 未覆盖 |

> **S6 证据开关（2026-11-14 拍板，速度当天接回现算）**：记忆维度先关着，因为「题库」必须是**被考者自己的**记忆库出的题——
> 我那份 55 题问的是 `identity/accounts.md` 之类的我的页面，别人既答不出也没有意义。所以不是「发题库」，是「发造题工具」：
> `node src/memory/gen.js --auto` 扫 `paths.memoryDir` 出候选草稿（`_work/candidates.json`），题面必须人工/AI 重写并抽检，
> 再 `--merge` 落题库、`ask.js` 出提问单、`judge.js` 判分、`score.js` 算分。
> 判分不再写死题号：`verdict-overrides.json` 只登记我方 2026-11-12 人工复核的 21 条，新库没有这个文件就走规则判分。
> 开之前先看 `memoryEvidence`：不填 = 未覆盖（不进 `min`、不按 0 分罚）。
> 速度不受这个开关限制：`src/tasks/segment.js` 已接进 run-all，每轮按日志现算，对谁都成立。
> 桌面版外发包**不带** `config.json`、`report.html`、`src/memory/report-offline.json`、`src/tasks/report.json`，
> 所以别人第一次跑出来只有**记忆、一致性**两格是「未覆盖」——记忆等 2026-11-19 开放（见 `docs/计划-可移植改造.md` S6）。

---

## 7. 已知边界（别当它是万能表）

- **速度**已接进 run-all：S1 = 所有 turn 耗时（turn/end − turn/start）全库中位；S2 = 任务段耗时中位（`src/tasks/segment.js`，N=3、4h 空闲）。N 改 2/5 时中位会漂，日志少时样本不足要标「部分覆盖」。
- **交付主档只算有 `turn` 的会话**，空会话单列「开而不用率」。
- **一致性未出数**：T0′ 基线已落，T1 要 ≥ 2026-11-19 复问。
- **成本只算会话日志口径**，不是账单：重试、标题生成、搜索 LLM 的 token 不落 `usage`，实际花费会偏高。
- **隔离是规则级不是物理级**：断网测试靠子代理守 prompt；DSH 当前 file policy 为 `danger-full-access`，明确授权后能读工作区。
- **所有数字都是快照**：日志在长，隔天复跑会漂；引用必须带样本时点。
- **小数据集会出「无样本」**：例如 0 个不可逆动作时 A2 标「未覆盖」，不按 0 分算。

---

## 8. 常见问题

**读到 0 条会话 / 报告一片空**
先看 `node scripts/doctor.js` 的「会话目录」和「会话数量」。要么 `sessionsDir` 指错，要么这台机器还没产生日志，要么适配器没注册。

**解不开 / 每份文件只有 180 字节**
多帧 zstd 只解了第一帧。检查是否绕过了 `src/zframes.js`。

**安全维度全绿，能信吗？**
不能直接信。规则表里带 `target` 标签：`dsh` 类规则依赖 DSH 的目录与工具名，换数据源后天然不命中，这是「没覆盖」不是「没问题」。跑完先看 `node src/safety/matcher.js` 的零命中清单——每条规则的命中数都会打出来，0 命中的要能说出为什么。用 `generic` 数据源时 `doctor` 也会专门提醒这一条。

**用了 generic 数据源，某个维度显示「未覆盖」或 0**
先看 `doctor` 的「数据源覆盖」那一行：它把工具 / 错误（ok/error）/ token / turn / 产物工具的实际映射打出来。
- 稳定是 0% 而日志里明明有报错 → `ok`（或 `error`）字段没配上，T1 判不了；
- 交付是 0 → `generic.productTools` 没填你的工具名（比如 `Write`、`str_replace_editor`、`bash`）；
- 成本出不了数 → `inputTokens` / `outputTokens` 没对上。

**速度 / 记忆 / 一致性显示「未覆盖」**
正常，这是 S6 的设计：速度与记忆的分数要靠本机证据文件（`speedEvidence` / `memoryEvidence`）才算得出来，一致性 T1 要到 2026-11-19 之后才出数。三个都标「未覆盖」时，综合分按剩余维度归一化，不是按 0 分罚。

**和上次跑的数字不一样**
日志在长。要对比就钉住同一份日志目录（冻结快照）+ 同一份 `config.json`，并且只比除时间戳外的字段。

**能打包给别人吗？**
`系统测评/` 整个目录就是全部（零依赖）。拷走时带上 `src/`（里面的 `*.json` 是历史产物）、`scripts/`、`report/`、`docs/`、`package.json`、`config.sample.json`；**不要**带 `config.json`、`_work/`、`_tmp/`、`.git/`。对方跑 `doctor` → `run-all` 即可。

---

## 9. 目录

```
系统测评/
├── package.json           脚本入口（零依赖）
├── config.sample.json     配置模板；config.json 是本机文件（不入库）
├── rules/                 安全规则表（47 条，带 target 标签）
├── docs/                  计划书、审查报告、断网复测、可移植改造
├── report/                template.html + 构建出的 report.html
├── scripts/               doctor / run-all / build-report / check-report / make-sample / export-events
├── src/
│   ├── config.js          唯一配置入口
│   ├── dataset.js         数据源注册表 + 缓存
│   ├── adapters/dsh.js    唯一认识 DSH 日志的一层
│   ├── adapters/generic.js 通用 JSONL：字段名在 config.generic 里配
│   ├── zframes.js         多帧 zstd 读取器
│   ├── cost/ honesty/ safety/ memory/ consistency/ tasks/  各维度脚本
│   └── score/             汇总（collect → report.json）
└── tests/                 口径自测（90 项）
```

---

## 10. 红线（改代码前先看）

1. `src/memory/questions.json` 与 `src/consistency/prompt-template.md` **2026-11-19 之前不许动**——一改一致性 T1 就作废。
   速度/记忆的证据开关（S6）已经建好，但**开放这三维本身也等 2026-11-19**。
2. 不动八维档位、权重、成本口径（2026-11-14 已定）。
3. 不把旧快照当成绩重跑。
4. `report/report.html` 必须保持单文件、离线可开、无外链。
