import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // 为什么钉住 1.90.0？
  //   @vscode/test-electron 2.5.2 在 macOS 上写死扩展宿主可执行文件为
  //   "Visual Studio Code.app/Contents/MacOS/Electron"，而较新的 VS Code
  //   （约 1.96 起）应用包里的可执行文件改名成了 Contents/MacOS/Code，
  //   于是 spawn ENOENT。1.90.0 的 macOS 包仍带 Electron，可正常启动。
  //   这里同时满足 package.json engines 的 ^1.82.0 下限。
  //   升级 @vscode/test-electron 后可以去掉这个 pin。
  version: '1.90.0',
});
