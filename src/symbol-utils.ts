/**
 * 符号工具：获取光标位置所在的函数/方法/类名。
 *
 * 用 VSCode 的 DocumentSymbolProvider 解析文件结构，
 * 找到包含目标位置的符号（函数/方法/类等）。
 */

import * as vscode from 'vscode';

/** 导航节点展示的上下文信息 */
export interface NodeContext {
  /** 符号名（函数/方法/类名，或光标处的单词） */
  symbolName: string;
  /** 所在的函数/方法/类名（比 symbolName 更高层级） */
  contextName: string;
}

/**
 * 获取光标位置的上下文信息。
 *
 * @param uri      文件 URI
 * @param line     1-based 行号
 * @param column   1-based 列号
 * @param fallback 当符号查找失败时使用的默认符号名
 * @returns NodeContext 包含 symbolName 和 contextName
 */
export async function getNodeContext(
  uri: string,
  line: number,
  column: number,
  fallback: string,
): Promise<NodeContext> {
  const documentUri = vscode.Uri.parse(uri);
  const zeroLine = line - 1;
  const zeroCol = column - 1;
  const position = new vscode.Position(zeroLine, zeroCol);

  try {
    // 调用 VSCode 的 DocumentSymbolProvider 获取文件所有符号
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      documentUri,
    );

    if (symbols && symbols.length > 0) {
      // 递归查找包含目标位置的符号
      const match = findDeepestEnclosing(symbols, position);
      if (match) {
        return {
          symbolName: fallback || match.name,
          contextName: buildContextPath(symbols, position),
        };
      }
    }
  } catch {
    // 符号查找失败（如文件无语言支持时），使用 fallback
  }

  return { symbolName: fallback || '(symbol)', contextName: '' };
}

/**
 * 递归查找包含 pos 的最深（最具体）符号。
 * 例如光标在函数内的某行，返回该函数符号；在类方法内，返回该方法符号。
 */
function findDeepestEnclosing(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
): vscode.DocumentSymbol | null {
  for (const sym of symbols) {
    if (sym.range.contains(pos)) {
      // 先在子符号中找更具体的
      if (sym.children && sym.children.length > 0) {
        const child = findDeepestEnclosing(sym.children, pos);
        if (child) return child;
      }
      return sym;
    }
  }
  return null;
}

/**
 * 构建从文件根到目标位置的符号路径。
 * 例如：["AppComponent", "ngOnInit", "loadData"] → "AppComponent.ngOnInit.loadData"
 * 用于在 UI 中显示更丰富的上下文信息。
 */
function buildContextPath(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
): string {
  const path: string[] = [];
  findPath(symbols, pos, path);
  return path.join('.');
}

function findPath(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
  path: string[],
): boolean {
  for (const sym of symbols) {
    if (sym.range.contains(pos)) {
      path.push(sym.name);
      if (sym.children && sym.children.length > 0) {
        findPath(sym.children, pos, path);
      }
      return true;
    }
  }
  return false;
}
