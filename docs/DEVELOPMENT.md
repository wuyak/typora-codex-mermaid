# 开发、构建与测试

开发者从源码构建；普通用户使用成品 ZIP，见[安装说明](INSTALL.md)。

## 构建环境

- Node.js 22.16 或更高版本；本次构建使用 24。
- Codex 桌面应用 `26.924.22138`，提供固定的 Mermaid 11.16.0 渲染快照。
- Python 3.9 或更高版本，仅供开发测试和打包使用。
- macOS 的系统 Perl；浏览器测试另需 Google Chrome。

渲染提取器检查应用版本及模块指纹，不支持任意新版。运行时不需要 Codex 或 Node.js，成品包已包含生成的引擎。

## 从源码构建

在仓库根目录运行：

```bash
npm ci
npm run extract
npm run build
```

默认读取 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 及同目录的 `THIRD_PARTY_NOTICES.txt`。其他路径可显式指定：

```bash
npm run extract -- "/path/to/YourApp.app/Contents/Resources/app.asar"
```

提取步骤只读取应用，生成 `vendor/`、`evidence/reference.js` 和来源记录。构建结果位于 `dist/`；这些本地生成物不进入 Git。

安装开发构建：

```bash
npm run install:typora
```

完整退出并重新打开 Typora。卸载使用 `npm run uninstall:typora`。

## 验证

```bash
npm run test:installer
npm test
```

安装器测试使用临时应用目录和用户数据，不修改真实 Typora。浏览器测试使用本项目锁定的 Playwright CLI，无需 Codex Skills；没有 Google Chrome 时可执行 `npx playwright-cli install-browser chrome`。

`npm test` 依赖提取步骤生成的 `evidence/reference.js`。覆盖多种图类型、明暗主题、原渲染流程对照、错误恢复、查看器、Typora API 兼容，以及 macOS Word 导出时 SVG 转 PNG 的尺寸边界，结果写入 `output/verification.json`。

Typora 将全局 `Node` 用于编辑器模型，与 DOMPurify 所需原生 DOM 类型冲突。构建仅修正依赖中该类型的来源，保留内容清理，不替换 Typora 的全局对象。

## 示例与打包

[插件形成过程图](../examples/plugin-overview.svg)记录渲染复刻、兼容问题、交互反馈与交付验证，供开发者了解项目过程。它不是面向使用者的功能说明。

首页示例源码为 `examples/publishing-workflow.mmd` 和 `examples/knowledge-search.mmd`。修改后分别运行：

```bash
npm run render:example -- publishing-workflow
npm run render:example -- knowledge-search
```

不传名称时生成开发过程图。打包运行：

```bash
npm run prepare:public
npm run package:mac
```

展示图由插件自身的引擎生成；SVG 进入 Git，PNG 检查副本留在 `output/`。

- `prepare:public` 根据 `public-files.json` 生成源码目录、源码压缩包和校验清单。
- `package:mac` 将预构建引擎、安装器、说明和示例打成 macOS ZIP，保留安装入口的可执行权限。
- 成品 ZIP 作为版本发布附件提供，源码通过 Git 管理；压缩包和本地证据均不提交到源码历史。

在标记版本前核对 `package.json` 与构建 manifest 的版本一致，并完成相应测试。来源声明必须随成品包一起保留。
