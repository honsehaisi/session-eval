# 给 AI 的适配器施工单（prompt 模板）

> 用途：你手上有一套自己的会话日志（Claude Code / Cursor / 自建 agent / 别家框架），想让「系统测评」读它。
> **先试通用格式**（README §5.1–5.2）：能导出 JSONL 就只改 `config.json`，不用写代码。
> 只有日志不是 JSONL（二进制、sqlite、私有串）时，才把下面这段 prompt 原样丢给你的 AI（Claude Code / Cursor / 任意能改仓库的 agent），让它照接口写一个适配器。

---

## 一、直接复制给 AI 的 prompt

```
你在仓库 系统测评/ 里工作（Node ≥22.15，零依赖，不 npm install）。

任务：给 src/adapters/ 新增一个适配器，让本仓的评测流水线能读 <你的日志名> 的会话日志。
不要改 src/ 下除 adapters/ 之外的任何文件。

第一步（必须先做，不要跳）：读这三个文件，用它们当接口真源，别凭印象写
- src/adapters/dsh.js  —— 唯一的参考实现（看 listSessions / parseSession / toEvents / sourceGlob 怎么分工）
- src/dataset.js        —— 注册表 ADAPTERS，加一行 { 名字: require('./adapters/名字.js') }
- README.md §5          —— 标准事件表（v1）与适配器必须导出的接口

适配器必须导出：
  listSessions(base, opts)   base = config.paths.sessionsDir
      → [{ id, dir, meta:{id,createdAt,cwd,origin,parentSession,delegationDepth},
           events:[…], stats:{records,parseErr,latestTime,bytes} }]
        解不开的文件给 { id, err }，不要 throw（一份坏文件不能拖垮整批）
  sourceGlob()               → 报给报告看：这份目录按什么模式找会话
  parseSession(file)         → { recs, parseErr }  （doctor「样本解码」会调）
  toEvents(records)          → 标准事件数组
  （可选）capabilities()     → { canJudgeError, canCostTokens, productTools }，doctor 会显示

必须产出的标准事件（字段含义见 README §5.3 表）：
  turn_start / turn_end / user_message / assistant_text / usage / tool_call / tool_result
其余 approval_* / policy / command 只有你有对应记录时才产出，没有就少产——不要编造。

硬要求：
1. 只读日志，不改、不移动、不删除原始文件；不联网。
2. 时间统一转毫秒时间戳；事件按日志原始顺序给，seq 递增。
3. usage 里 inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens 必须都是数字（没有就 0）。
4. tool_call 与 tool_result 的 callId 必须能配上；配不上就自己生成稳定的 id。
5. tool_result.isError：日志有明确报错标记才 true/false；没有就 null（不要默认 false —— 那是假绿）。
6. 禁止把 core 的八维口径、权重、档位当成你的活；你只负责「记录 → 标准事件」。

自检三连（三条都要过，把输出贴回来）：
  node scripts/make-sample.js --format generic        # 造一份通用格式示例，别直接拿真日志调式
  node scripts/make-sample.js --out D:/tmp/demo-claude   # 再用你自己的样例造一份，或直接指真日志
  SYSEVAL_CONFIG=<你的配置> node scripts/doctor.js     # 必须没有 ✗
  SYSEVAL_CONFIG=<你的配置> node scripts/export-events.js --limit 2   # 眼验：事件类型对不对、tool_call 有名字、usage 有数字
  SYSEVAL_CONFIG=<你的配置> node scripts/run-all.js     # 必须 11/11 步成功
  node --test tests/                                   # 原有 90 项必须全绿，再加你自己的适配器单测

交回来的时候说明：
- 日志的字段结构（贴一行原文，脱敏）
- 四个维度（速度/稳定/成本/交付）哪几个有数、哪几个没有，为什么
- 已知盲区（比如没有 token 记录、没有轮次概念、工具名没路径）
```

---

## 二、常见坑（人看）

| 坑 | 后果 | 怎么躲 |
|---|---|---|
| 默认 `isError: false` | 稳定 T1 变 0% → A 档假绿 | 判不了就 `null`，让 `doctor` 点出来 |
| 一个事件一行、但数据有多个 turn | 速度 S1 失真（每行一个 turn，耗时恒为 0） | 从记录里找轮次；实在没有就用 `turns: "infer"` 按 user 行切 |
| usage 里的 token 是字符串 | 成本算出 NaN | 转 number，缺的补 0 |
| 把整份日志一次性读进内存 | 大日志 OOM | 逐行读（`split('\n')` 已经是逐行解析，别一次性 JSON.parse 整个数组） |
| 为了「好看」编 approval / policy 事件 | 安全维度假命中/假绿 | 没有就少产；缺事件只影响覆盖，不影响其它维度 |
| 改 core 去迁就自己的字段 | 下次别人接入又得改 core | 字段差异全在适配器里消化；`config` 里能配的就别写死 |

## 三、不用写代码的情况

只要你的日志能导出成「一行一步」的 JSONL（时间、turn、工具名、ok、token、stop），
就不用写适配器：`paths.dataSource = "generic"` + `config.generic.fields` 填字段名（README §5.2），
`node scripts/make-sample.js --format generic` 造个样例对照着改最快。
