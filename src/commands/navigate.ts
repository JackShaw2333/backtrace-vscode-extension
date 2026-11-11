/**
 * 导航工具：跳转到节点所在位置。
 *
 * 被 goBack、goForward、TreeDataProvider 共同使用。
 * 独立成文件而不是放在任意一个命令文件中，避免语义混淆。
 *
 * 两个跳转入口（别用错）：
 *   - navigateToNode：笨跳，跳给定的行列，不做任何定位。
 *     只给 jump-to-caller 用（调用点没有存符号身份，做不了重定位，
 *     它的保鲜全靠 position-tracker 实时跟随，见 jump-to-caller.ts）。
 *   - navigateToNodeResolved：先定位后跳转，唯一的"节点跳转"出口。
 *     goBack / goForward / 树点击全走这里，保证行为一致。
 */

import * as vscode from 'vscode';
import { NavNode } from '../nav-node';
import { resolveNodePosition } from '../symbol-utils';

/**
 * 内部导航标志。
 * navigateToNode 执行前设为 true，CommandWatcher 检测到后忽略本次选择变化。
 */
export let isInternalNav = false;

/**
 * 先定位后跳转（节点跳转的唯一出口）。
 *
 * 流程（对应 resolveNodePosition 的三分支）：
 *   1. 'found' → 自愈回写（更新 node.line/column，顺手清掉 stale→"复活"），
 *      再跳新位置。回写后 fire _treeChanged：刷新视图＋持久化，
 *      调用方自己的 fire 负责 reveal 当前节点，分工不重复。
 *   2. 'unverifiable'（无语言支持等，没法验证）→ 相信旧行号直接跳，
 *      什么都不标——这是"不知道"，不是"没了"。
 *   3. 'missing'（符号真没了）→ 标 stale + 写回 + 状态栏提示，
 *      原地不动（不断链：currentNode 照常已经由调用方移过去了，
 *      只是文件不跳，避免把光标送到错误的代码上）。
 *
 * 时序安全：await 等语言服务时我们还没动光标，所以不会触发
 * CommandWatcher；真正跳转时才立 isInternalNav 旗子，和以前一样。
 * 用户在等待期间自己动了光标也不怕——跳转是"跳到目标"，覆盖即可。
 */
export async function navigateToNodeResolved(node: NavNode): Promise<void> {
  const label = node.contextName || node.symbolName || 'node';
  const outcome = await resolveNodePosition(node.uri, node.symbolName, node.contextName, node.line);

  if (outcome.status === 'found') {
    const wasStale = node.stale === true;
    const moved = outcome.line !== node.line || outcome.column !== node.column;
    node.line = outcome.line;
    node.column = outcome.column;
    node.stale = false;
    // 只有真变了才 fire：没变说明位置本来就是准的，别打扰 UI。
    if (moved || wasStale) {
      if (wasStale) {
        console.log(`[Backtrace] revived stale node → ${label}`);
      }
      vscode.commands.executeCommand('backtrace._treeChanged');
    }
    navigateToNode(node);
    return;
  }

  if (outcome.status === 'unverifiable') {
    navigateToNode(node);
    return;
  }

  // 'missing'：符号真没了。只在第一次标 stale 时 fire + 提示，
  // 重复点同一个 stale 节点不再刷屏（幂等）。
  if (!node.stale) {
    node.stale = true;
    vscode.commands.executeCommand('backtrace._treeChanged');
    // 带上符号身份，方便排查“代码没变却被标 stale”的误判：
    // symbolName/contextName 就是重定位用的身份证，缺失/错位一眼可见。
    console.log(
      `[Backtrace] marked stale → ${label} (symbol="${node.symbolName}", context="${node.contextName}") @ ${node.uri.split('/').pop()}:${node.line}`,
    );
  }
  vscode.window.setStatusBarMessage(
    `$(warning) Backtrace: ${label} no longer found — marked stale (× to delete)`,
    4000,
  );
}

/**
 * 跳转到指定位置（文件 + 行列）。
 *
 * 类型定义 { uri: string; line: number; column: number } 只要求三个必要属性，
 * 不要求完整的 NavNode 对象——这叫"结构类型"（structural typing）。
 *
 * @param node 目标位置
 */
export function navigateToNode(node: { uri: string; line: number; column: number }): void {
  const uri = vscode.Uri.parse(node.uri);

  // showTextDocument 会触发 onDidChangeTextEditorSelection，
  // 设置标志让 CommandWatcher 知道这是内部导航，不要记录跳转。
  // 200ms 后自动清除，不影响后续用户操作。
  isInternalNav = true;
  setTimeout(() => {
    isInternalNav = false;
  }, 200);

  // openTextDocument 返回 Promise（异步操作：读取文件需要时间）
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      // selection 参数：设置光标选中位置。
      // new vscode.Range(startLine, startCol, endLine, endCol)
      // start 和 end 相同 → 零宽度范围 = 光标定位
      vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(node.line - 1, node.column - 1, node.line - 1, node.column - 1),
      });
    },
    () => {
      // 文件可能已被删除 → 显示错误消息但不抛异常
      vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`);
    },
  );
}
