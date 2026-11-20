# dsh-prompt-studio

DSH Web GUI 里的 **preset 编写入口**：侧边栏「预设」按钮 → 列出全部 agent preset，**直接编辑它们的 system prompt**（persona prefix/suffix）与名称/描述/order，或从模板新建 preset。改的是 preset 定义本身，不是某个会话的临时覆盖。

## 在哪、怎么用

1. 刷新 Web GUI（client 模块由 clientModules 扫描加载，无需重启）。
2. 侧边栏点 **预设**。
3. 列表里点一个预设展开：改 **persona prefix**（模型实际看到的开头指令）、suffix、名称、描述、order，点 **保存到 preset**。
4. 保存写入 profile patch，HMR live reconcile 重新注册 → **新建的会话**使用新提示词（已经打开的会话保持原组装）。
5. 底部 **新建预设**：填 id/名称/order，选一个模板（复制其工具组成），写自己的 persona → 创建后出现在会话的 preset 菜单里。
6. **上下文压缩参数（可见表单）**：预设展开后，若该 preset 有 compaction-basic 行（例如 Lean Context），面板里会出现「上下文压缩」区块，可直接改：
   `keepRounds`（保留最近几轮原文）、`remindOnRound`（第几轮注入提醒，空=跟随 keepRounds）、`reminder`（提醒文案，留空=引擎默认）、`alwaysMinSpanTokens`、`retainTokens`、`alwaysCompact`。
   点「保存到 preset」同时写 persona 与这些参数（yaml 文档 API，注释/`!!js` 保留，自动 `.bak` 备份），live 重载后新会话生效。

列表标记：`profile patch` = 定义在本 profile 的 patch 里（原地编辑）；`bundle 定义 · 编辑将生成覆盖行` = 定义在 bundle 里（保存时自动追加一条同 id 的完整覆盖行到 patch 末尾）；`激活失败` = 该 preset 当前加载有诊断。

## 实现

- Host：`presets.js`，三个路由
  - `GET /preset-studio/list` — registry roster + 合成配置里的 persona 文本 + 来源分类
  - `POST /preset-studio/save` — 原地改 profile patch 里的 preset 行；bundle preset 则追加覆盖行
  - `POST /preset-studio/create` — 以 base preset 的合成 plugins 为模板追加新 insert 行
  写 path 用 `yaml` 文档 API（**注释与 `!!js` 表达式完整保留**），写前自动 `.bak-preset-editor-<ts>` 备份、临时文件 rename 原子替换。
- Client：`client.js`，`sidebar.panellist`「预设」入口 + `main` 编辑面板（persona + 压缩参数表单）。
- 压缩参数路由：`compaction-config.js`（单独行挂载，`/preset-studio/compaction` GET/POST），便于用 `?rev=` 热更新而不动精确包名的 client 扫描行。
- 挂载：profile patch 单行 `- id: preset-studio / name: 'dsh-prompt-studio/presets'`；包已 link 进 profile `node_modules`；插件目录在 `hmr.root` 里（改代码可热重载）。

## 测试

```
npm test   # node --check ×2 + node --test test/presets.test.mjs
```

5 个用例：list 分类与 persona 文本、原地保存（断言 `!!js` 表达式逐字保留、注释保留、可再解析）、bundle preset 保存生成覆盖行、create 克隆模板生成新 insert 块、重复 id 拒绝。

## 已知边界

- 保存会按 YAML 文档风格重新序列化文件（注释与 `!!js` 表达式保留；实测与原文差异仅个别空行归一化）。
- 只编辑 persona 与元数据；工具组成（plugins 行）目前「复制模板」级别，逐行增删工具仍需手改 YAML。
- 已打开的会话不重新组装 preset，新会话才用新提示词。
