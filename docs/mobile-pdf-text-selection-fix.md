# 移动端 PDF 文字选择修复 + 统一 pdfjs-dist 版本

> 日期：2026-08-01
> 范围：仅基于 `main` 分支（`9c601b82` 桌面修复之后）；不依赖 `fix/android-pdf-custom-selection(-publish)` 等未合入 main 的分支。
> 参考实现：readest（`packages/foliate-js/pdf.js` 的 `getFontScale` / `MAX_RENDER_DPR` / `MAX_CANVAS_PIXELS` / `isMobileWebView` workaround）。

---

## 一、问题现象

- **移动端**（Expo + react-native-webview）打开 PDF 书时**无法选中文字**：长按不出选区、拖选高亮与字形错位。
- **桌面端**（macOS/PC，Tauri）PDF 文字选择已修好（`9c601b82`），移动端仍坏。
- 另外全仓 `pdfjs-dist` 版本混乱（`app`/`cli`/`core` 为 `^5.5.207`，`foliate-js` 为 `^4.7.76`，解析为 4.10.38，还有 npm 遗留的 `package-lock.json` 钉死旧版）。

---

## 二、根源分析（Root Cause）

### 根因 1：移动端加载的是过期的构建产物

移动端 `ReaderScreen.tsx:165` 用 `Asset.fromModule(require("../../assets/reader/reader.html"))` 加载**提交进 git 的 bundle**（`reader.html`），而不是像桌面端 vite 那样直接打包当前源码。

| | 桌面端 | 移动端 |
|---|---|---|
| 加载方式 | vite 实时打包当前源码 | 提交的静态 `reader.html` |
| 最后构建 | 随源码 | **2026-07-04**（`4d25e6bb`），早于桌面修复 22 天 |
| 内嵌 pdfjs | 5.5.207 | **4.10.38** |
| 渲染方式 | 显示坐标渲染（canvas 过采样 + CSS 盒为显示尺寸，`9c601b82` 重写的 `render()`） | 旧的 `documentElement.style.transform = scale(1/devicePixelRatio)` 缩放 |

旧 bundle 用的缩放方式是 readest `de6d810` 点名批评的"**misplacing text selection**"写法：缩放文档根元素而不是只放大 canvas 位图，导致选区/标注工具栏定位错位。**桌面能修好是因为 vite 直接打包了当前源码；移动端 bundle 22 天没重建，等于桌面修复完全没进移动端。**

> **版本差异澄清**：`includeMarkedContent`/`dontFlip` 并不是 4.10.38 → 5.5.207 的差异 —— 两个版本的 bundle 里都有这些字符串（它们本来就是 pdf.js API 选项）。真正的差异是 foliate-js 的 `render()` 在 `9c601b82` 的重写（canvas 过采样 + CSS 盒显示尺寸 + 选择/复制逻辑），桌面修复的正是这部分，而移动端 bundle 22 天没重建，所以桌面修复完全没进去。

### 根因 2：模板把 reflow 样式注入 PDF iframe（独立新 bug）

即使重建 bundle，`reader.template.html` 仍有第二个问题：它把 EPUB 的 reflow 排版样式**注入到每个 doc 的 iframe**，包括 PDF 的 fixed-layout iframe：

- `applySettings()` 的 `baseStyles` 注入 `font-size: ${fSize}px !important`、`font-family: var(--readany-font-family) !important`、`line-height` —— 而 **pdf.js 的 TextLayer 字形字号完全由 CSS 变量计算**（`font-size: calc(var(--text-scale-factor) * var(--font-height))`），注入会击穿这些计算，让选区错位。注意这一点**并非 5.5.207 版本特有**：旧 4.10.38 bundle 里的 CSS 变量 text layer 同样会被击穿 —— 这恰恰**加强了**根因 2（无论版本，模板注入 reflow 样式都会破坏 PDF TextLayer，只是之前被旧 bundle 的缩放 bug 掩盖了）。
- `applyDocStyles()` 注入 `p, div, span … { color: inherit !important }` —— 覆盖 `.textLayer span { color: transparent }`，让 PDF 透明字形**显形**叠在 canvas 上。

桌面端 `FoliateViewer.tsx:3275-3284` 早已有这个 `isFixedLayout` 守卫（注释写明"否则会破坏 PDF TextLayer 定位"），**移动端模板缺这个守卫**。

### 根因 3（潜在）：移动端缺少 readest 的移动端内存/字号 workaround

即便前两个修好，还有两个移动端特有的问题：

- **iOS 辅助功能"大字号"**：系统字号缩放会把 WebView 里所有文字（包括透明的 TextLayer 字形）按 `fontScale` 放大，但 **canvas 位图不变** → 字形比 canvas 上的大 `fontScale` 倍，选区整体偏大、下移。
- **iOS WKWebView ~2GB 内存天花板**：iPad 真机 dpr=3，canvas 位图 + WebKit backing layer 的内存按 **dpr 的平方**增长，翻几页就 WebContent OOM 崩溃。

---

## 三、解决方案（怎么做）

### Part 1 — 修复核心：`packages/foliate-js/pdf.js` 加入移动端 workaround

参考 readest，在 pdf.js 渲染路径上加三个函数：

1. **`getFontScale(doc)`**：插入一个 `font-size:100px; line-height:1; text-size-adjust:none` 的探测 div，用 `offsetHeight / 100` 量出系统字号缩放比（`offsetHeight` 反映 OS 字号缩放，但不反映 dpr 和 CSS transform，能精确隔离它）。

2. **`isMobileWebView()`**：UA 含 `Android|iPhone|iPad|iPod`，或 `Macintosh + navigator.maxTouchPoints > 1`（覆盖 iPadOS 伪装桌面 UA 的情况）。

3. **`getRenderDpr(page, zoom)`**：移动端 dpr 钳到 `MAX_RENDER_DPR = 2`，且按单页 canvas 面积上限 `MAX_CANVAS_PIXELS = 2048*1536` 降采样；桌面端直接返回真实 dpr。

在 `render(page, doc, zoom)` 内接入：

- `outputScale = devicePixelRatio` → `renderDpr = getRenderDpr(page, zoom)`，canvas 的 `width/height/transform` 全部改用它。**保持"canvas 过采样 + CSS 盒是显示尺寸"的结构不变**，只是把过采样系数换成了受钳制的 `renderDpr` —— 等价 readest 的 renderViewport/displayViewport 分离，但不重写已经工作的桌面路径。
- `await textLayer.render()` 之后：若 `fontScale !== 1`，把 `--text-scale-factor` 设为 `calc(var(--total-scale-factor) * var(--min-font-size) / ${fontScale})` —— **只除字形字号杠杆，不动位置杠杆**（`--total-scale-factor`）。桌面 `fontScale === 1` → no-op。
- 补健壮性：annotation linkService 加 `getAnchorUrl: () => ""`（pdf.js AnnotationLayer 对 named-action 注解会调用，缺失会 reject）。

### Part 2 — 模板层加 fixed-layout 样式注入守卫（对照桌面）

文件：`packages/app-expo/assets/reader/reader.template.html`

新增 `buildFixedLayoutStyles(bg, fg, primary)` —— 只含安全块：

- `:root { --readany-font-family: … }`
- `html, body` 的 `background-color` / `color`
- `.textLayer, .textLayer :is(span, br) { color: transparent !important; }`（保住 TextLayer 字形透明）
- `::selection` 高亮色

三个注入路径都加 `view.isFixedLayout` 守卫：

| 路径 | 原行为 | 改后（fixed-layout） |
|---|---|---|
| `applySettings()` | 注入含 font-size/font-family/line-height 的 `baseStyles` | 用 `buildFixedLayoutStyles`，且**不经过** `injectThemeIntoStyles`（避免重新引入 `color: inherit`） |
| `applyDocStyles()` | 注入 reflow 样式 + `color: inherit !important` | 用安全块 + `* { user-select: text }` 等对选择有益的部分，去掉 reflow |
| `setThemeColors()` | `injectThemeIntoStyles` 重新包装 `lastRendererStyles` | 直接用新颜色重建安全块 |

### Part 3 — 重建并提交 `reader.html`

改完源码后执行 `node packages/app-expo/scripts/build-reader.js` 重新生成 `reader.html` 并**提交**（维持"提交产物"机制，`Asset.fromModule` 需要 Metro 构建期的静态资源）。

**加固构建脚本**（`build-reader.js`）：build id 从硬编码 `'android-local-server-cors'` 改为 `git rev-parse --short HEAD` + ISO 时间戳，注入模板里的 `__READANY_READER_BUILD_ID = 'build-id-placeholder'`。之后 bundle 与源码漂移可通过 RN debug 消息 `[ReaderBuild] <id>` 立即发现。

### Part 4 — 统一 pdfjs-dist 版本

1. `packages/foliate-js/package.json`：`"pdfjs-dist": "^4.7.76"` → `"^5.5.207"`（保留在 devDependencies，foliate-js 是 workspace 源码包）。
2. **删除** `packages/foliate-js/package-lock.json`（npm 遗留物，钉死 4.7.76）。
3. `pnpm install` 重新生成 `pnpm-lock.yaml`，移除 `pdfjs-dist@4.10.38` 条目。
4. 清理死配置：
   - `packages/app/vite.config.ts`：删除 `@pdfjs` alias（指向不存在的 `foliate-js/vendor/pdfjs`）和 `optimizeDeps.exclude`。
   - `packages/foliate-js/rollup.config.js`：删除 `copyPDFJS()`（把 pdfjs 复制到无人引用的 `vendor/pdfjs/`）及未用依赖 `fs-extra`。

---

## 四、为什么这么改（设计决策）

1. **只在 foliate-js/pdf.js 层加 workaround，不动渲染架构**：桌面端已修好且经测试，重写成 readest 的 renderViewport/displayViewport 双视口方案风险大。用 `getRenderDpr` 替换 `outputScale` 是**最小侵入** —— 桌面 `isMobileWebView() === false`，渲染路径与改动前完全一致，**零桌面回归**。

2. **`fontScale` 只除字形字号杠杆（`--text-scale-factor`）**：TextLayer 有两个 CSS 变量 —— `--total-scale-factor` 管位置、`--text-scale-factor` 管字形字号。OS 字号缩放只影响字形（font-size），所以只除字形杠杆，位置（随 `--total-scale-factor`）不受影响，任何字号设置下选区都能与 canvas 对齐。

3. **移动端 dpr 钳到 2 而不是 3**：canvas 位图和 WebKit backing layer 内存随 dpr **平方**增长，dpr=3 → 2 省 ~2.25 倍每页内存，仍 retina 清晰（可选的透明文字层是独立 DOM 层不受影响）。**桌面不钳**：桌面无每进程内存天花板，钳制只买来模糊（readest #5251）。iPadOS 伪装桌面 UA，所以用 `maxTouchPoints` 补识别。

4. **fixed-layout 守卫采用"跳过 + 白名单"而不是"硬编码 PDF 特判"**：用 `view.isFixedLayout`（view.js 对 PDF/CBZ 已置位）判 `isFixedLayout`，不硬编码 `pdf.js`。这样 EPUB/CBZ 的 reflow 不受影响，只有 PDF 走安全块。

5. **不经过 `injectThemeIntoStyles`**：那个函数会加 `color: inherit` 规则，正是让 PDF TextLayer 字形显形的元凶；fixed-layout 的安全块已经自包含主题色，直接注入即可。

6. **继续提交 `reader.html` 产物**：`Asset.fromModule(require(...))` 需要 Metro 构建期静态资源，改动 `require` 为动态加载成本高、收益低；EAS 构建已有 `eas-build-post-install` 再跑一次 `build:reader` 双保险。加固 build id 让"过期 bundle"这种事故可检测。

7. **版本统一到 `^5.5.207`**：桌面端已在用且验证过；旧 `^4.7.76` 既没有 `includeMarkedContent`/`dontFlip` 等新逻辑，也靠 hoist 巧合才解析到根 node_modules 的 5.5.207，是隐藏的时炸弹。

---

## 五、改了什么内容（Diff 清单）

### 源码改动（9 个文件）

| 文件 | 改动 |
|---|---|
| `packages/foliate-js/pdf.js` | +88 行。新增 `getFontScale` / `isMobileWebView` / `getRenderDpr` / `MAX_RENDER_DPR=2` / `MAX_CANVAS_PIXELS=2048*1536`；`render()` 里 `outputScale` → `renderDpr`；`textLayer.render()` 后加 fontScale 校正；annotation linkService 补 `getAnchorUrl` |
| `packages/app-expo/assets/reader/reader.template.html` | +112 行。新增 `buildFixedLayoutStyles()`；`applySettings()` / `applyDocStyles()` / `setThemeColors()` 三处加 `view.isFixedLayout` 守卫，fixed-layout 不注入 reflow 样式、不走 `injectThemeIntoStyles`；build id 占位符改 `'build-id-placeholder'`。**复核修复**：`applyDocStyles` 的 fixed-layout 分支改同步 `fixedLayoutStyles`（当前主题色）而非 `lastRendererStyles`，修复 EPUB→PDF 同 WebView 切换时陈旧 reflow 样式泄漏进 PDF 第一页（见"五·补"） |
| `packages/app-expo/assets/reader/reader.html` | 重建产物。内嵌 pdfjs **5.5.207** + 全部新 workaround；旧的 `scale(1/devicePixelRatio)` 缩放消失 |
| `packages/app-expo/scripts/build-reader.js` | +24 行。`getBuildId()`（git sha + 时间戳）替换模板中的 build id 占位符 |
| `packages/foliate-js/package.json` | `pdfjs-dist ^4.7.76` → `^5.5.207`；删除未用的 `fs-extra` |
| `packages/foliate-js/rollup.config.js` | 删除 `copyPDFJS()` 插件及 `fs-extra` import |
| `packages/foliate-js/package-lock.json` | **删除**（npm 遗留，钉死 4.7.76） |
| `packages/app/vite.config.ts` | 删除死 `@pdfjs` alias（指向不存在的 `foliate-js/vendor/pdfjs`）和 `optimizeDeps.exclude` |
| `pnpm-lock.yaml` | 重新生成；`pdfjs-dist@4.10.38` / `pdfjs-dist@4.7.76` 全部消失，foliate-js importer → 5.5.207 |

### 验证结果

| 检查 | 结果 |
|---|---|
| core 测试（vitest） | ✅ 565 passed |
| cli 构建 | ✅ exit 0 |
| app（vite）构建 | ✅ exit 0 |
| biome lint | ✅ 通过 |
| bundle 标记 | ✅ 含 probe `font-size:100px` / `maxTouchPoints` / `2048*1536` / `5.5.207`，旧 `scale(1/dpr)` 已消失（注：esbuild 压缩后函数名被改名，`getFontScale`→`dJ` 等，核对需按代码特征而非名字） |
| lockfile | ✅ 无 4.x pdfjs 残留 |

---

## 五·补、独立复核发现与修复（2026-08-01）

对本文档的分析/方案及代码实现做了三路独立复核（pdf.js 实现正确性 / 模板守卫与构建脚本 / 文档与依赖改动），并逐一从实际代码验证。结论：

| 复核维度 | 结论 |
|---|---|
| pdf.js 实现 | ✅ 正确，桌面零回归成立 |
| 文档 + 依赖 | ✅ 大部分准确（3 处小错已修订），方案可行 |
| 模板守卫 + 构建脚本 | ⚠️ With fixes → **发现并修复 1 个 Important 缺陷** |

### 复核确认的关键点（此前未写进正文）

1. **bundle 过期与重建可证**：旧 bundle 的确含 `documentElement.style.transform = scale(${1/devicePixelRatio...` 且 build id 为 `'android-local-server-cors'`；新 bundle 的 probe/`maxTouchPoints`/`2048*1536`/`/ ${d}` 等字符串只存在于未提交的 `pdf.js` 源码 → **证明 bundle 确由当前工作区重建**。
2. **桌面零回归成立**：Tauri macOS WKWebView UA 是 `Macintosh` 但 `maxTouchPoints=0`（触控板不算触控点），Windows 无 mobile token → `getRenderDpr` 短路返回真实 dpr，与旧 `outputScale` 逐字节等价。
3. **fontScale 校正不会被丢**：pdf.js `TextLayer.render` 只写 `--min-font-size`/`--font-height`，从不写 `--text-scale-factor`；span 字号是活的 var 引用，改 var 后全部 span 重新流式。
4. **`MAX_CANVAS_PIXELS` 并非硬上限**（Important）：`zoom²·dpr²` 把 dpr 压到 1 以下时被 `Math.max(1, dpr)` 挡住，重度放大的平板页仍可能超预算。与 readest 相同、且远好于旧 bundle 的无钳制 dpr-3，不算回归，但注释里"hard ceiling"措辞偏乐观 —— 已接受。
5. **`getFontScale` 量化到整数 CSS px**：iOS Dynamic Type 档位（1.15/1.3…）够用，但不是连续测量 —— 已接受。

### Important 缺陷：`lastRendererStyles` 陈旧泄漏（已修复）

- **根因**：`lastRendererStyles`（模板 L197）是模块级变量，`openBook()` 里**从未重置**；而 `FixedLayout.getContents()`（foliate-js/fixed-layout.js:351）返回的项没有 `index`，模板 `getRendererContents()`（L566）过滤 `content.index == null` → **fixed-layout 下返回空数组**，`syncReaderOverrideStylesForAllDocs()` 对 PDF 恒为 no-op。
- **触发场景**：**同一 WebView 内 EPUB → PDF 切换**（ReaderScreen 在 `bookId` 变化时复用同一 Reader 挂载，如 TTS 跳转/深链）。EPUB 先打开把 `lastRendererStyles` 设为 reflow 样式（font-size/font-family/line-height `!important`）；PDF 第一页 `load` → `applyDocStyles` 把**陈旧的 reflow 样式**注入第一页；之后 `applySettings` 更新了 `lastRendererStyles`，但同步对 fixed-layout 是 no-op → **第一页永久残留 reflow 覆盖，TextLayer 字号被击穿**。
- **修复**：`applyDocStyles` 的 fixed-layout 分支改同步**刚计算的 `fixedLayoutStyles`**（总是取自当前主题色，免疫陈旧状态）而非 `lastRendererStyles`。已重建 bundle 验证 `syncReaderOverrideStylesForDoc(doc, fixedLayoutStyles)` 在内。

### 复核记录的其他事项

- **Minor — `setThemeColors` fixed-layout 分支是死代码**：`FixedLayout` 没有 `setStyles`（只有 `Paginator` 有），`if (view.renderer.setStyles)` 对 PDF/CBZ 恒 false。与改动前行为一致（非回归），但注释"rebuild the safe block with the new colors"言过其实；主题变更不重绘 PDF（改动前亦如此）。**未改，仅记录。**
- **Minor — 选区颜色不一致**：fixed-layout 用蓝 `rgba(59,130,246,0.3)`，reflow 用黄 `rgba(250,204,21,0.4)`。PDF 选区高亮与 EPUB 不同。**未改，仅记录。**
- **Minor — build-reader.js 的 `replace` 不匹配时静默失败**：模板占位符若漂移，bundle 会带着 `'build-id-placeholder'` 发出且构建期无警告。**未改，仅记录。**

### build-id 时序提醒（重要）

当前 bundle build id 是 `9c601b82-…`，而 `9c601b82` 是**修复前的 commit**（源码改动未提交）。bundle 与源码一起提交后，`[ReaderBuild]` 会显示一个与"修复 commit"不匹配的 sha。**正确流程：commit 之后需再跑一次 `node packages/app-expo/scripts/build-reader.js` 并提交重建的 bundle**，否则漂移检测机制会在落地后立刻显示 stale。

---

## 六、剩余验证（需真机/模拟器）

开发环境无法启动模拟器，以下需人工确认：

1. **桌面回归**：开 PDF，验证文字选择对齐、跨行复制、双页 spread 无缝隙、缩放清晰度与改前一致（理论上零回归，桌面 `isMobileWebView() === false`）。
2. **移动端**（`expo run:ios` / `android:dev`）：
   - iPhone 真机多页 PDF：长按选词、拖选跨行，选区与字形严格对齐，复制进工具条。
   - iOS 设置 → 辅助功能 → 显示与文字大小 → 大字号 → 重开 PDF：选区仍对齐（getFontScale）；EPUB 不受影响。
   - iPad（dpr=3）：连续翻页/缩放不触发 WebContent 崩溃（getRenderDpr 钳制）。
   - Android：选择 + 复制正常，无 OOM。
   - 回归：EPUB 选择/注解/TTS、PDF 翻页/TOC/搜索/章节提取正常，`.textLayer span color` 修复后无可见文本叠加。

---

## 七、涉及的关键概念

- **pdf.js TextLayer**：canvas 是位图不可选，TextLayer 是在 canvas 上叠一层透明的 DOM 文字（span），靠 CSS 变量算字号/位置，天然支持浏览器原生选择。**视图层（canvas）与 TextLayer 必须严格一致**，任何一方被额外缩放/注入样式都会错位。
- **`--total-scale-factor` vs `--text-scale-factor`**：前者管位置（百分比容器缩放），后者管字形字号（font-size）。修复时只动字形杠杆。
- **fixed-layout vs reflow**：PDF/CBZ 是 fixed-layout（每页固定尺寸的 iframe），EPUB 是 reflow（流式排版，可注入字号/行距）。reflow 样式注入 fixed-layout 文档会破坏 TextLayer。
