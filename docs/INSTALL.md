# 安装路径与卸载

本文适用于 macOS 成品包。用户需要已安装 Typora；安装器使用系统 `/bin/bash`、`/usr/bin/perl` 及 Perl 自带模块，无需另外安装 Python、Node.js 或 Codex。

## 默认安装

完整退出 Typora，解压成品包，然后双击包内的 `Install.command`。安装成功后重新打开 Typora。

也可以在终端进入解压目录执行：

```bash
/bin/bash ./Install.command
```

安装器会先检查包内文件、目标路径和已有安装记录。没有写权限或发现无法确认归属的旧文件时会停止并显示错误，不会自动提权或关闭系统保护。

## 文件放在哪里？

| 用途 | 默认路径 |
| --- | --- |
| 修改的 Typora 启动页面 | `/Applications/Typora.app/Contents/Resources/TypeMark/index.html` |
| 插件文件 | `~/Library/Application Support/abnerworks.Typora/codex-mermaid/` |
| 入口备份与安装状态 | `~/Library/Application Support/abnerworks.Typora/.codex-mermaid-standalone/` |
| 安装记录 | 上述备份目录中的 `state.json` |

插件目录包含 `main.js`、`engine.js`、`renderer.js`、`viewer.js`、`manifest.json` 和来源声明。启动页面中的加载语句位于 `codex-mermaid-loader:start` 与 `codex-mermaid-loader:end` 标记之间。

Typora 启动时加载该脚本，所以无需开启社区插件功能。该方式会修改应用资源，不是 Typora 官方提供的扩展接口。

## Typora 装在其他位置

在解压目录中指定实际入口。例如应用安装在当前用户的 Applications 下：

```bash
/bin/bash ./Install.command \
  --app-index "$HOME/Applications/Typora.app/Contents/Resources/TypeMark/index.html"
```

自定义用户数据目录：

```bash
/bin/bash ./Install.command \
  --user-data "$HOME/Library/Application Support/abnerworks.Typora"
```

两个参数可以同时指定。卸载时使用相同参数；不要把目录参数指向其他用户的数据。

## 卸载

完整退出 Typora，然后双击 `Uninstall.command`，或在包目录中运行：

```bash
/bin/bash ./Uninstall.command
```

默认情况下，卸载器恢复备份入口并移除本次安装的插件文件。如果启动页面后来被修改，只移除本插件的标记块；如果某个插件文件后来被修改，则保留该文件并报告路径。备份和安装记录会保留，便于检查。

不要手工删除安装记录后再运行安装器；它需要用记录确认文件归属。若丢失安装包，可以使用同版本仓库中的安装脚本执行卸载：

```bash
/usr/bin/perl scripts/manage.pl uninstall
```

## 应用更新与异常

- **Typora 更新后效果消失**：更新可能替换启动页面；完整退出 Typora，重新运行安装入口。
- **插件文件被外部修改**：安装器会停止，避免覆盖无法确认的更改。先检查报错中的文件和备份。
- **目标入口不存在**：核对实际 Typora 安装目录，再使用 `--app-index`。
- **没有写权限**：确认应用属于当前用户、目录可写；安装器不自动使用管理员权限。
- **系统阻止启动或提示应用损坏**：不要据此关闭系统保护。先保留错误信息；能够运行卸载器时可撤销修改，否则可从官方来源重新安装 Typora。

已在 macOS 环境（Typora 1.13.4 / 7690）实测可用，涵盖渲染、编辑、重启后加载、图表预览与触控板操作，HTML、PDF、Word 导出已验证。安装器在隔离目录中测试了安装与恢复行为。其他 Typora 版本及 Windows / Linux 尚未验证。成品包不是经过 Apple 签名、公证的安装应用。
