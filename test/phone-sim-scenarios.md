# phone-sim 线级失败场景手册

配套脚本：`test/phone-sim.mjs`。所有失败场景均在脚本内**临时启动一个本地 mock SSE 服务器**（监听 `127.0.0.1` 随机端口，跑完即关）来注入线级故障——不杀真实后端进程、不发起任何真实 LLM API 调用。

## 0. 用法总览

```bash
# 既有默认链路（行为与扩展前完全一致）
node test/phone-sim.mjs "帮我查一下今天李老师的课"

# 列出全部场景
node test/phone-sim.mjs --list

# 运行某个失败场景（消息可省略，默认同上）
node test/phone-sim.mjs --scenario <名称> [消息]
```

通用可选参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--base <url>` | `http://localhost:3000` | 目标后端地址（默认模式与场景模式均生效） |
| `--key <key>` | `uestc-helper-proxy-key-change-me` | `X-Proxy-Key` 请求头 |
| `--watchdog-ms <n>` | `6000` | 场景 b：客户端首字节看门狗阈值 |
| `--first-byte-delay-ms <n>` | `9000` | 场景 b：mock 服务器推迟首个字节的时长 |
| `--tool-result-fail-times <n>` | `1` | 场景 f：`/api/tool-result` 前 N 次返回 500 |

退出码：观察到的线级结果与场景预期一致 → `0`；不一致或参数错误 → `1`（可直接用于 CI 断言）。

SSE 帧格式与真实后端 `src/index.ts` 对齐：

```
data: {"type":"text_chunk","content":"..."}
data: {"type":"tool_call","batch_id":"..","tool_calls":[{"tool_call_id":"..","name":"..","args":{}}]}
data: {"type":"final","telemetry":{}}
data: {"type":"error","message":".."}
```

---

## 前端容错规格速查（预期行为的判定依据）

| 线级事实 | 预期前端行为 |
|---|---|
| 首个 SSE 事件到达前失败（拒连 / 首字节超时） | 指数退避自动重试 2 次（1s 后第 1 次、3s 后第 2 次），仍失败才提示网络异常；不得白屏/卡死 |
| 已收到部分内容后连接中断 | 保留已收文本、标记中断态、提供「重新发送」入口 |
| 流干净结束但缺 `final` 帧 | 按 `completed_with_warning` 处理：轻提示（如“回答可能不完整”），内容照常展示，不进错误态 |
| 收到 `error` 帧 | 展示错误信息；此前已有部分内容时按“已收内容后中断”处理 |
| `tool-result` 回传失败 | 客户端本地重试 2 次（间隔 0.5s、2s），三次均失败才放弃本轮 |

---

## (a) conn-refused —— 连接拒绝（服务不可达）

**触发方式**

```bash
node test/phone-sim.mjs --scenario conn-refused
```

实现方式：脚本先临时绑定一个随机端口再立即释放（全程不触碰真实进程），随后向该“无监听”端口发起点对点连接。

**线级帧序列**

```
client -> POST /api/chat (TCP SYN)
<-- TCP RST（ECONNREFUSED），无任何 HTTP/SSE 字节
```

脚本侧会按规格自动重试：第 1 次失败 → 等 1s 重试 → 第 2 次失败 → 等 3s 重试 → 第 3 次失败后终止。

**预期前端行为**

- 属「首事件前失败」：指数退避自动重试 2 次（1s/3s）；
- 全部重试仍失败 → 展示友好网络异常提示（非白屏、非无限 loading）；
- 会话内容保留，可手动重新发送。

---

## (b) first-byte-timeout —— 首字节延迟超时（watchdog）

**触发方式**

```bash
# 默认：mock 推迟 9s 才发首字节，客户端 watchdog 6s 即触发断开
node test/phone-sim.mjs --scenario first-byte-timeout

# 快速验证版（约 9s 跑完）
node test/phone-sim.mjs --scenario first-byte-timeout --watchdog-ms 1500 --first-byte-delay-ms 4000

# 反向验证注入点本身：延迟小于阈值时应得到一次成功流
node test/phone-sim.mjs --scenario first-byte-timeout --first-byte-delay-ms 100 --watchdog-ms 6000
```

**注入点说明**：延迟在 mock 服务器侧注入（`--first-byte-delay-ms`）。若真实链路无法在服务端注入首字节延迟，可将 `--watchdog-ms` 缩小以等效触发同一 watchdog 分支（已在脚本注释注明）。

**线级帧序列**

```
client -> POST /api/chat          （含 AbortController 挂看门狗）
server <- 200 握手被推迟，N ms 内零字节
watchdog 到期 -> client abort，连接关闭（无任何 SSE 帧）
[脚本自动重试两次，每次同样超时]
```

若 `--first-byte-delay-ms < --watchdog-ms`，则超时后放行一条正常流：

```
data: {"type":"text_chunk","content":"这是首字节延迟放行后的正常回答。"}
data: {"type":"final","telemetry":{}}
```

**预期前端行为**

- 首字节超时发生在首个事件前 → 「首事件前失败」：指数退避自动重试 2 次（1s/3s）；
- 三次尝试全部超时 → 友好网络异常提示，不得卡死在 loading 态。

---

## (c) missing-final —— 流正常结束但缺 final 帧

**触发方式**

```bash
node test/phone-sim.mjs --scenario missing-final
```

**线级帧序列**

```
HTTP/1.1 200 (text/event-stream)
data: {"type":"text_chunk","content":"这是缺失 final 帧场景的部分"}
data: {"type":"text_chunk","content":"回答内容，服务器随后正常关闭了连接。"}
（TCP FIN —— 连接干净关闭，无 final、无 error）
```

**预期前端行为**

- 判定为 `completed_with_warning`：轻提示（如“回答可能不完整”）；
- 已收文本正常展示，**不进入错误态**、不出现重试风暴；
- 用户可继续追问或手动重发。

---

## (d) mid-stream-error —— 流中途发出 error 帧

**触发方式**

```bash
node test/phone-sim.mjs --scenario mid-stream-error
```

**线级帧序列**

```
HTTP/1.1 200 (text/event-stream)
data: {"type":"text_chunk","content":"先输出一部分正常内容，"}
data: {"type":"error","message":"[mock] 上游模型调用失败(upstream error)"}
（服务器 res.end()，流正常结束）
```

**预期前端行为**

- 展示 error 帧携带的错误信息；
- 因此前已收到部分正文，按「已收内容后中断」规格处理：保留已收内容、标记中断态并提供「重新发送」；
- 不清空已有文本、不白屏。

---

## (e) mid-stream-reset —— 流中途连接重置/截断

**触发方式**

```bash
node test/phone-sim.mjs --scenario mid-stream-reset
```

**线级帧序列**

```
HTTP/1.1 200 (text/event-stream)
data: {"type":"text_chunk","content":"这段回答会在"}
data: {"type":"text_chunk","content":"中途被强制切断……"}
data: {"type":"text_chun            <-- 半个残帧（非法 JSON 行，顺带检验容错）
（socket.destroy() —— RST，无 final、无 error）
```

**预期前端行为**

- 已收内容后传输层异常中断 → 标记中断态、保留已收文本、提供「重新发送」按钮；
- 客户端必须能忽略残缺 JSON 行而不崩溃（本脚本已把解析改为跳过非法帧）；
- 不得白屏、不得无限 loading、不得触发「首事件前失败」的重试路径（因为已有事件）。

---

## (f) tool-result-fail —— tool-result 回传失败（本地重试）

> 该场景对应规格中「tool-result 回传失败 → 本地重试 2 次(0.5s/2s)」，作为 a–e 的补充项加入。

**触发方式**

```bash
node test/phone-sim.mjs --scenario tool-result-fail                       # 第 1 次回传 500
node test/phone-sim.mjs --scenario tool-result-fail --tool-result-fail-times 2   # 前 2 次均 500
node test/phone-sim.mjs --scenario tool-result-fail --tool-result-fail-times 3   # 三次全失败 -> error 帧兜底
```

**线级帧序列**（以 `--tool-result-fail-times 1` 为例）

```
HTTP/1.1 200 (text/event-stream)
data: {"type":"text_chunk","content":"好的，我来帮你查询今天的课程。"}
data: {"type":"tool_call","batch_id":"batch-mock-001",
       "tool_calls":[{"tool_call_id":"call-mock-001","name":"app_data_query","args":{"domain":"course"}}]}
client -> POST /api/tool-result   --> HTTP 500（注入的失败）
         [等 500ms]  第 2 次回传  --> HTTP 200，mock 放行后半段
data: {"type":"text_chunk","content":"今天李老师的课程有：高等数学(品学楼A101)、离散数学(品学楼B202)。"}
data: {"type":"final","telemetry":{}}
```

**预期前端行为**

- 回传失败 → 本地重试 2 次（间隔 0.5s、2s）；
- 任一次成功 → 对话继续走完至 final，用户无感；
- 三次均失败（`--tool-result-fail-times >= 3`）→ 本轮按失败处理，界面提供「重新发送」（mock 此时下发 error 帧兜底）。
