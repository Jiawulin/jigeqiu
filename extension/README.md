# 记个球浏览器扩展

本扩展将 Chrome / Edge 新标签页替换为记个球工作台。普通用户直接下载扩展 ZIP
即可本地安装，不需要 Node.js、网站服务器或源码构建。

## 下载与首次安装

1. 打开仓库 [Releases](https://github.com/jiawulin/jigeqiu/releases)，
   在所选版本的 **Assets** 中下载 `jigeqiu-extension-X.Y.Z.zip`。
   不要选择 `jigeqiu-vX.Y.Z-web.zip` 或 GitHub 自动生成的 Source code。
2. 解压到准备长期保留的固定目录，确认目录内直接有 `manifest.json`。
3. Chrome 打开 `chrome://extensions` 并开启“开发者模式”；Edge 打开
   `edge://extensions` 并开启“开发人员模式”。
4. 点击“加载已解压的扩展程序”（Edge 为“加载解压缩的扩展”），选择上述目录。
5. 打开新标签页，确认浏览器的新标签页提示，阅读并确认首次启动的隐私说明。

ZIP 需要先解压，不能双击安装，也不是 CRX 文件。安装后不要移动或删除该目录。
如果另一个扩展也替换新标签页，需先处理冲突。本地安装不等于所有功能离线：
远程图片、外部搜索和打开网站仍会联网。权限与数据用途以应用内隐私说明为准。

## 更新已安装扩展

1. 在“管理中心 → 导入与导出”导出 JSON 资产备份，保存到浏览器之外。
2. 关闭已打开的扩展页面，把新版 ZIP 的完整内容更新到原安装目录，
   保持路径与扩展身份不变。
3. 在扩展管理页点击“重新加载”，打开新标签页检查版本和收藏。

不要通过卸载重装来升级，卸载可能删除扩展数据。JSON 资产备份不包含全部
设置、桌面布局和壁纸，不能当成完整环境恢复。网页与扩展的数据不自动同步，
网页到扩展以及跨浏览器迁移均需要手动导出／导入。

## 界面语言

扩展与网页版使用相同规则：优先使用已保存的语言选择；首次使用时按浏览器偏好列表
顺序匹配中文或英文；没有支持的语言时回退中文，不回退英文。
可在工作台顶部切换语言，成功保存后，重新打开、刷新及其他扩展标签页都会沿用该选择。
扩展的隐私告知、完整隐私说明和远程图片提醒使用同一界面语言。
仅补充翻译不会清除原有隐私确认记录，也不会改动收藏数据。

浏览器扩展管理页中的名称与简介由浏览器自身的界面语言决定，
不受工作台内保存的语言选择控制；缺少对应翻译时使用中文。

## 本地存储与升级

收藏、目录、回收站、桌面布局、设置、搜索引擎及引导和隐私告知记录使用
`chrome.storage.local`，默认配额为 10 MiB，不提供账号同步，不申请
`unlimitedStorage`。壁纸和图标缓存继续保存在 IndexedDB。

首次启动在跨标签页锁内迁移当前扩展来源下的旧 LocalStorage 数据，
写入并读回核对后才进入应用。原数据保留但不再参与日常读写；
迁移失败不进入空收藏库，也不删除旧数据。网页来源的数据无法自动读取，
仍需先导出后导入。

日常修改等待 Chrome 确认并核对后才显示成功。容量不足时保留输入供重试；
无法确认保存结果时请刷新核对，不要盲目重复提交。
多个标签页共享写锁；旧页面的收藏库基线发生变化时拒绝覆盖并提示刷新。
卸载扩展或删除浏览器配置仍可能删除数据，请定期导出独立备份。

## 构建与打包

在项目根目录安装依赖：

```sh
npm ci
```

本地开发与安装：

```sh
npm run build:extension
```

输出到根目录 `dist-extension/`。构建时从根目录 `package.json` 读取版本，
从 `public/favicon.ico` 提取 16、32、48、128px PNG 图标，并复制公共资源和许可证。
不需要手动同步版本或维护另一套图标源文件。

准备分发：

```sh
npm run package:extension
```

此命令先重新构建，再检查清单、入口、本地脚本、样式资源与图标，最后生成：

```text
release-extension/
├── jigeqiu-extension-<version>.zip
└── SHA256SUMS.txt
```

ZIP 根目录直接包含 `manifest.json`，没有多余的 `dist-extension/` 外层目录。
打包不依赖系统 `zip` 命令。ZIP 可用于商店提交，但构建成功不等于商店审核通过。
发送给其他人本地试用时，对方需要先解压，再加载解压后的目录。

原 `npm run build` 仍构建网页版，输出到 `dist/`。两套构建互不覆盖。

## GitHub Actions 打包

工作流 `.github/workflows/extension.yml` 在推送到 `master`，
或通过 Actions 页面手动运行时执行扩展测试、构建、打包和 SHA256 校验。

进入仓库 **Actions → Package Browser Extension → 对应运行记录 → Artifacts**，
下载 `jigeqiu-extension-<commit SHA>`。解压下载的 Artifact 后，可找到扩展 ZIP
和 `SHA256SUMS.txt`。本地安装时再解压其中的扩展 ZIP，选择直接包含
`manifest.json` 的目录。Artifact 保留 30 天，不会自动创建或修改 GitHub Release，
也不会发布到 Chrome / Edge 商店。

正式版本由 `.github/workflows/release.yml` 统一发布。推送与 `package.json`
版本一致的 `vX.Y.Z` 标签后，流水线执行完整检查，构建 Web 和扩展包，
核验两个 ZIP，并将以下附件上传到同一个草稿 Release：

```text
jigeqiu-vX.Y.Z-web.zip
jigeqiu-extension-X.Y.Z.zip
SHA256SUMS.txt
```

附件上传后会下载回验，全部成功才自动公开 Release。失败时保留草稿，
可在 Actions 中重跑该 tag 的发布工作流；已有草稿会被复用。
完整草稿校验通过后直接公开，不重复上传；不完整草稿只补传缺失附件，
已有附件与本次构建不一致时停止，避免重试删除仍可用的包。
已公开版本只校验远端附件与其校验文件，不覆盖现有包。
同一 tag 存在多个 Release 或公开版本缺包时会明确失败，需要维护者手动处理，
不会删除发布记录或静默修改已公开版本。

两个 ZIP 均下载后，可在同一目录执行 `sha256sum --check SHA256SUMS.txt`。
正式安装下载扩展 ZIP 后只需解压一次，选择直接包含 `manifest.json` 的目录。
这不是 CRX 自动安装包，也不会自动发布到扩展商店。

## 源码构建后的本地加载

以下路径适用于已运行 `npm run build:extension` 的开发者。
下载 Release 的用户按上方步骤选择自己的解压目录，不需要创建 `dist-extension/`。

### Chrome

1. 在地址栏输入 `chrome://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择项目根目录下的 `dist-extension/`。
4. 打开新标签页；若浏览器询问是否保留新标签页更改，确认保留。

### Edge

1. 在地址栏输入 `edge://extensions`。
2. 开启开发人员模式。
3. 点击“加载解压缩的扩展”，选择同一个 `dist-extension/`。
4. 打开新标签页，并在浏览器提示时确认启用扩展或保留更改。

修改代码后重新构建，在扩展管理页点击重新加载，再刷新新标签页。
无需卸载重装；卸载可能导致扩展数据丢失。保持加载目录不变。
若另有扩展替换新标签页，需要处理两者的冲突。

## 测试

```sh
npm run test:extension
```

浏览器冒烟测试沿用项目现有的外部 Playwright 运行方式：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser:extension
```

Windows PowerShell 示例：

```powershell
$env:PLAYWRIGHT_MODULE = 'file:///C:/path/to/playwright/index.mjs'
npm run test:browser:extension
```

外部 Playwright 版本与已安装浏览器不一致时，可以额外设置
`PLAYWRIGHT_EXECUTABLE_PATH` 指向兼容的 Chromium 可执行文件。
测试使用独立的临时用户配置，不读取日常浏览器书签或配置。
覆盖新标签页加载、Web Locks、收藏保存与刷新、多标签页共享存储、
原有图标请求、候选选择、手动图片、资源加载、Hash 路由和 CSP；
使用受控图片响应检查原有图标逻辑，确认不再使用扩展原生图标接口。
截图输出到 `test-results/extension/`。
此自动测试使用 Chromium，不代替 Chrome / Edge 正式版本的手动验收或商店审核。
