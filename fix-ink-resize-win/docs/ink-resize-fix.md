# Ink resize 花屏 / 叠影修复

## 背景

OpenHarness 的终端前端基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLI）。
在 Windows Terminal（ConPTY）下，多轮交互后拖动/缩放终端窗口会出现两类渲染问题：

- **左右缩放（宽度变化）**：当前屏幕花屏，新旧画面字符叠在一起。
- **上下缩放（高度变化）**：旧画面帧被推进滚动缓冲区，出现一层层重复的 Box 叠影。

涉及版本：本仓库 `frontend/terminal` 使用 ink **5.2.1**（逻辑同样存在于 4.x）。

---

## 一、根本原因

### 1.1 Ink 的差量更新机制

Ink 在主屏幕缓冲区用 `log-update`（`node_modules/ink/build/log-update.js`）做差量刷新，核心：

```js
const render = (str) => {
    const output = str + '\n';
    if (output === previousOutput) return;
    previousOutput = output;
    // 先向上擦除 previousLineCount 行，再写新内容
    stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
    previousLineCount = output.split('\n').length;
};
```

它依赖一个内部状态 `previousLineCount`——"上一次画了多少行"。
每次刷新先 `eraseLines(previousLineCount)` 往上擦掉旧内容，再写新内容。
**这个机制的前提是：光标位置固定、终端宽度不变。**

### 1.2 原版 resize 处理没有重置该状态

Ink 原版 `resized()`（`node_modules/ink/build/ink.js`）只有两步：

```js
resized = () => {
    this.calculateLayout();  // 按新尺寸重算布局
    this.onRender();         // 重新渲染
};
```

它**没有重置 `log-update` 的 `previousLineCount`，也没有清屏**。于是：

| 缩放方向 | 失效原因 | 现象 |
|----------|----------|------|
| 左右（宽度变） | 换行位置全变，实际行数 ≠ `previousLineCount`，`eraseLines` 擦错行数，旧内容擦不净 | 当前屏幕花屏 |
| 上下（高度变） | 仍按旧位置擦/画，旧帧被挤进 scrollback | 滚动缓冲区叠影 |

### 1.3 ConPTY 的事件风暴

拖动窗口时，Windows Terminal / ConPTY 会以极高频率（毫秒级）连续广播 `resize` 事件。
即使单次重绘正确，连续几十次清屏 + 重画也会造成剧烈闪烁，且中间帧尺寸还在变化，画了也是白画。

---

## 二、修复思路演进

修复过程中尝试过多个方案，记录失败原因有助于理解最终方案为何如此：

1. **只加 `log.clear()`**
   重置了行数，但没清 scrollback → 上下缩放仍有叠影。

2. **`log.clear()` + `\x1b[2J\x1b[H`（只清可见区）**
   `eraseLines` 仍可能在错误光标位置擦除 → 左右缩放仍乱；scrollback 旧帧仍在。

3. **`clearTerminal` + 重打印 fullStaticOutput（无防抖）**
   单次正确，但 ConPTY 事件风暴导致连续触发 → 多个 Box 叠影。

4. **加防抖，但用 `eraseLines(rows)` 手动清屏**
   行数算不准，宽度变化后擦除范围错位 → 仍残留。

5. **最终方案：防抖 + log.clear + 硬清屏(含 3J) + 同步重绘**
   三个根因（事件风暴 / 行数错乱 / scrollback 残留）全部覆盖 → 左右、上下、滚动全部干净。

关键认知：**三个问题必须同时解决，缺一个就会在某个维度复现。**

---

## 三、最终修复

替换 `node_modules/ink/build/ink.js` 中的 `resized`：

```js
resized = () => {
    // 1. 防抖：合并 ConPTY 的连续 resize 事件，只在尺寸稳定后处理一次
    if (this._resizeTimer) {
        clearTimeout(this._resizeTimer);
    }
    this._resizeTimer = setTimeout(() => {
        this._resizeTimer = undefined;
        if (this.isUnmounted) {
            return;
        }
        // 2. 按新的 columns/rows 重算布局
        this.calculateLayout();
        // 3. 重置 log-update 内部行数状态，避免用过期的 previousLineCount
        //    去 eraseLines（左右缩放花屏的根因）
        this.log.clear();        // previousLineCount = 0, previousOutput = ''
        this.lastOutput = '';    // 强制 Ink 认为输出已变化，必定重画
        // 4. 硬清屏：清可见区 + 清滚动缓冲区 + 光标归位，给重绘一块干净画布
        this.options.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        // 5. 同步重绘：先打印固化的 Static 历史，再画动态区
        const { output } = render(this.rootNode);
        this.options.stdout.write(this.fullStaticOutput);
        this.log(output);
        this.lastOutput = output;
    }, 100);
};
```

> 注意：`render`、`ansiEscapes` 已在 `ink.js` 顶部 import；`this.fullStaticOutput`
> 是 Ink 累积的 `<Static>` 输出。若实际文件是经过 TS 编译的
> `Object.defineProperty(this, "resized", { value: () => { ... } })` 形式，
> 把 `value` 函数体替换为上述逻辑即可。

### 各步骤职责

| 步骤 | 作用 | 解决的问题 |
|------|------|-----------|
| 1. 防抖 100ms | 最后一次 resize 后安静 100ms 才重绘一次 | ConPTY 事件风暴导致的连续重绘/闪烁 |
| 2. `calculateLayout` | 用新尺寸让 Yoga 重排 | 内容按新宽高布局 |
| 3. `log.clear()` + `lastOutput=''` | 清零"上次画了几行"的记录 | **左右缩放花屏的根因** |
| 4. `\x1b[2J\x1b[3J\x1b[H` | 清可见区 + 清 scrollback + 光标归位 | 上下缩放叠影、残留旧帧 |
| 5. 重打印 Static + 动态区 | 历史 + 当前画面一次性干净绘出 | 历史不丢、不重复 |

### 防抖语义

每个新 resize 都 `clearTimeout` 掉上一个待执行定时器并重新计时。
只要 resize 持续到来（间隔 < 100ms），重绘就一直被推迟；
**直到最后一次 resize 之后安静满 100ms，才强制执行一次干净重绘。**
100ms 只影响响应快慢，不影响正确性——核心是"稳定后强制重绘一次"。

### ANSI 序列说明

- `\x1b[2J` — 清除可见屏幕字符
- `\x1b[3J` — 清除滚动缓冲区（scrollback）；**本项目目标终端支持**，故历史不会重复
- `\x1b[H`  — 光标移到左上角 (0,0)

---

## 四、已知边界情况

**竞态**：在防抖等待的 100ms 窗口内，若用户同时打字触发了普通 `onRender`，
该路径仍用旧的 `previousLineCount`（此时宽度已变），中间帧可能短暂花屏。

- **自愈**：最后那次 resize 回调的硬清屏会把花屏盖掉，**最终态始终干净**。
- **不修**：触发条件是"一边拖窗口一边打字"，极罕见且能自愈，为它增加复杂度不值得。

---

## 五、配合 `<Static>` 的架构前提

此修复假设应用已正确区分静态/动态区域：

- **`<Static>`**：只增不删的历史（已完成的对话、工具调用结果、日志），输出后固化。
- **动态 `<Box>`**：会变化的内容（Spinner、输入框、状态栏、流式输出）。

只要动态区行数不超过 `stdout.rows`，正常刷新走差量更新路径，不触发全屏 `clearTerminal`；
resize 时再由上述 `resized` 兜底做一次干净重绘。

---

## 六、持久化（待办）

当前修改直接落在 `node_modules/ink/build/ink.js`，`npm install` 会覆盖丢失。
需用 [`patch-package`](https://www.npmjs.com/package/patch-package) 固化为补丁：

```bash
cd frontend/terminal
npm install --save-dev patch-package
npx patch-package ink                       # 生成 patches/ink+5.2.1.patch
# 在 package.json 增加: "scripts": { "postinstall": "patch-package" }
```

**OpenHarness 特殊性**：`node_modules` 不随 Python wheel 打包，而是用户首次启动时由
`src/openharness/ui/react_launcher.py` 触发 `npm install` 现装。需另行确认：
patch 文件与 `postinstall` 脚本能被打进发布产物、且用户侧 `npm install` 会执行
`postinstall`，否则补丁仅在开发机生效，发布版仍是原版 ink。
