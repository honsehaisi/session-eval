# 大肥鱼测评 · 给 AI 的使用方式

> 这份文档写给「会读代码、会敲命令」的 AI 助手。目标是让你在几分钟内帮用户把数据源接上、把一次测评跑完。
> 人读版在程序里的「使用方式」按钮，以及交付目录的 `使用说明.md`。

## 1. 这是什么

一个本地的八维测评工具：读 AI 助手的会话日志 → 算分（速度/稳定/成本/交付/安全/诚实/记忆/一致性）→ 出一份单文件 HTML 报告。不联网、不外传。

## 2. 包里有什么

```
大肥鱼测评-win32-x64/
├─ 大肥鱼测评.exe          # Electron 壳，双击打开窗口
├─ resources/
│  ├─ app.asar             # 界面（工具栏：重新测评 / 使用方式 / 日志 / 设置）
│  └─ eval/                # 评测运行时：源码 + 规则 + 脚本
│     ├─ scripts/          # doctor / run-all / build-report / make-sample ...
│     ├─ src/              # 各维度实现 + 适配器（dsh.js / generic.js）
│     ├─ rules/safety.json # 安全规则表（可换）
│     └─ README.md         # 数据格式与配置详解（§5 是通用格式）
├─ 使用说明.md             # 给人读的
└─ 打不开就试这个.cmd      # 启动兜底（加 --no-sandbox）
```

## 3. 先判断用户的数据源

| 用户情况 | 做法 |
|---|---|
| 用 DSH（日志在 `~/.dsh/sessions`） | 双击直接跑，或命令行：`node scripts/run-all.js` |
| 用 Claude Code / Cursor / 自建流程 | 走第 4 节「通用 JSONL」 |
| 没有任何日志 | 只能空跑看界面；建议先攒一段日志 |

## 4. 通用 JSONL 最小格式

一行一条事件，UTF-8。字段名不重要——名字在配置里映射；重要的是**语义**：

```json
{"t": 1730000000000, "turn": 1, "type": "tool", "tool": "write_file", "ok": true, "in": 1200, "out": 300, "stop": "completed", "session": "s1"}
```

| 语义 | 示例字段 | 说明 |
|---|---|---|
| 时间 | `t` | 毫秒/秒/ISO 字符串都行（auto 识别） |
| 轮次 | `turn` | 整数；没有就用 `turns: "infer"` 按 user 行切轮 |
| 类型 | `type` 或 `role` | user / assistant / tool |
| 工具名 | `tool` | 也可以是一个对象 `{"name": "write"}`，适配器取 `.name` |
| 是否成功 | `ok` | true/false；**没有就别填**，会记 unknown（不默认成功） |
| token | `in` / `out` | 输入/输出 token |
| 结束原因 | `stop` | completed / aborted / interrupted / error…；空 = unknown |
| 会话 id | `session` | 可选，`sessionMode: "field"` 时必填 |

**重要**：没有 ok/error 字段时 `isError` 记为 `null`，稳定维度会告警——别为了让报告好看补一个 `ok: true`。

## 5. 配置（config.json）

程序运行时配置在 `%APPDATA%\大肥鱼测评\runtime\config.json`（命令行跑则用项目根 config.json 或 `SYSEVAL_CONFIG` 指向的文件）。generic 示例：

```json
{
  "paths": {
    "dataSource": "generic",
    "sessionsDir": "D:/my-agent-logs",
    "memoryDir": "~/.memory",
    "defaultCwd": "",
    "memoryEvidence": "",
    "speedEvidence": ""
  },
  "roots": { "extraWriteRoots": [] },
  "generic": {
    "fileGlob": "**/*.jsonl",
    "timeUnit": "auto",
    "turns": "field",
    "sessionMode": "file",
    "productTools": ["write_file", "bash"],
    "fields": {
      "time": "t",
      "turn": "turn",
      "type": "type",
      "tool": "tool",
      "ok": "ok",
      "inputTokens": "in",
      "outputTokens": "out",
      "stop": "stop",
      "session": "session"
    }
  }
}
```

- `fileGlob` 支持 `*` `?` `**`；默认一个文件 = 一个会话（`sessionMode: "file"`），一文件多会话用 `"field"`。
- `productTools`：哪些工具算「产物动作」（交付维度）。DSH 工具名已内置，别人要自己填。
- 字段名支持 `a.b` 点取嵌套（如 `usage.prompt_tokens`）；没有的字段留空字符串。

## 6. 命令行跑一遍

```bash
cd resources/eval

node scripts/make-sample.js --format generic   # 可选：造一份示例日志先自检
node scripts/doctor.js                         # 数据源体检，10 项里不要有 ✗
node scripts/run-all.js                        # 11 步流水线，1～4 分钟
node scripts/build-report.js                   # 生成 report/report.html
```

图形界面里点「重新测评」等价于 run-all + build-report。

## 7. 各维口径（简）

- **速度**：所有 turn 耗时全库中位（S1）+ 任务段中位（S2），0.75/0.25 加权。
- **稳定**：T1 工具失败率、T2 异常结束占比。
- **成本**：有效会话（≥1 步）平均花费；USD→CNY 按 7.1。
- **交付**：有产物动作（`productTools`）的会话比例。
- **安全**：按 `rules/safety.json` 规则表命中；**generic 下只覆盖 33 条通用规则，dsh 类 14 条天然 0 命中——报告给 A 不代表安全**。
- **诚实**：否定句/未验证声明的宽判（claims 样本）。
- **记忆 / 一致性**：当前未覆盖（等 2026-11-19 开放），不参与综合分。

### 记忆维度怎么测（等开放后）

记忆测的是「你记不记得自己的记忆库」，所以题库**必须从你自己的库生成**，不能用别人给的题：

```bash
node src/memory/gen.js --auto          # 扫 paths.memoryDir → _work/candidates.json（草稿）
# 人工/AI 重写 prompt_draft、抽检 5–10 题，删掉凑数的
node src/memory/gen.js --merge _work/candidates.json   # 落题库
node src/memory/ask.js                 # 出分批提问单
# 按提问单作答，写 _work/answers-raw.jsonl
node src/memory/judge.js               # 判分（没有覆盖文件就走规则）
node src/memory/score.js               # M1/M2/M3 → 维度分
```

题库抽不满（页面太少）就让它空着标「未覆盖」，**不要拿别人的题凑数**。

## 8. 已知限制

1. 记忆、一致性显示「未覆盖」，不是 0 分。
2. generic 的安全覆盖面有限，见第 7 节。
3. 程序未签名，SmartScreen 首次会拦（点「更多信息 → 仍要运行」）。
4. 必须放在**可写目录**运行；不要放 Program Files。
5. 从带 `ELECTRON_RUN_AS_NODE=1` 的终端启动会被当成 node 跑而报错；双击不受影响。

## 9. 排错

- 跑出来空的：先 `doctor.js`，看数据源和字段映射有没有命中。
- 成本/稳定/交付显示未覆盖：多半是日志里缺 token 或工具事件。
- 报告页没刷新：点「重新测评」重跑，或手动 `build-report.js`。
