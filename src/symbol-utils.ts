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
 * 符号匹配用的最小形状。
 *
 * 为什么不直接用 vscode.DocumentSymbol？
 *   匹配逻辑只读 name / range.start / children 这三处，
 *   定义成最小接口后，单元测试可以用普通对象字面量当假数据，
 *   不用起 VSCode 环境。真正的 DocumentSymbol 结构更丰富，
 *   但"形状兼容"（多出来的 kind/detail 等字段不影响赋值），
 *   所以直接传进来就能用——这叫"结构类型"的鸭子类型。
 *
 * 行列都是 VSCode 原生的 0-based（第一行是 0），和 NavNode 的
 * 1-based 不同，进出 findSymbolPosition 时要 ±1，千万别混。
 */
export interface SymbolLike {
  readonly name: string;
  readonly range: { readonly start: { readonly line: number; readonly character: number } };
  readonly children: readonly SymbolLike[];
}

/** 重定位到的位置（1-based，和 NavNode 同口径）。 */
export interface SymbolPosition {
  line: number;
  column: number;
}

/**
 * 跳转时重定位的结果（三选一，调用方必须处理全部分支）。
 *
 * 'found'        → 按符号身份找回了当前位置，跳新的行列并自愈回写。
 * 'unverifiable' → 没法验证（文件无语言支持 / 查符号失败），
 *                  注意：这不等于"符号没了"，所以相信旧行号正常跳，
 *                  绝不能标 stale，否则纯文本文件的节点全军覆没。
 * 'missing'      → 文档有符号，但我们的符号不在其中 → 真的没了，标 stale。
 */
export type ResolveOutcome =
  { status: 'found'; line: number; column: number } | { status: 'unverifiable' } | { status: 'missing' };

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
 * 跳转时重定位：按符号身份找回当前位置。
 *
 * 时机：navigateToNodeResolved 在真正跳转前调用本函数。
 * 身份 = symbolName（目标词）+ contextName（符号路径，如 "App.ngOnInit"），
 * 都是当初记录跳转时存下的。行号会漂，但"哪个类里的哪个方法"一般不会漂。
 *
 * 判定顺序不能反（见 ResolveOutcome 的注释）：
 *   1. 查符号失败 / 文档零符号 → 'unverifiable'（相信旧行号）。
 *   2. 按身份找到 → 'found'（取 range.start，口径见 findSymbolPosition）。
 *   3. 有符号但找不到 → 'missing'（标 stale）。
 *
 * @param uri         文件 URI（toString 后的字符串）
 * @param symbolName  记录的目标符号名
 * @param contextName 记录的符号路径（可能为空字符串）
 * @param nearLine    旧行号（1-based）：重名时选离它最近的那个
 */
export async function resolveNodePosition(
  uri: string,
  symbolName: string,
  contextName: string,
  nearLine: number,
): Promise<ResolveOutcome> {
  let symbols: vscode.DocumentSymbol[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      vscode.Uri.parse(uri),
    );
  } catch {
    // 语言服务报错（如文件太大被拒）→ 当作没法验证，不标 stale。
    return { status: 'unverifiable' };
  }

  // 文档没有任何符号（纯文本、无语言支持）：无法验证，相信旧行号。
  if (!symbols || symbols.length === 0) {
    return { status: 'unverifiable' };
  }

  // 记录时就没拿到符号名（fallback 的 '(symbol)'）：没有身份就没法认，
  // 同样按"无法验证"处理——相信旧行号（实时跟随仍在保鲜它），绝不标 stale。
  if (!symbolName || symbolName === '(symbol)') {
    return { status: 'unverifiable' };
  }

  const pos = findSymbolPosition(symbols, symbolName, contextName, nearLine);
  if (!pos) {
    return { status: 'missing' };
  }
  return { status: 'found', line: pos.line, column: pos.column };
}

/**
 * 在符号树里按身份找位置（纯函数，不碰 VSCode API，可单测）。
 *
 * 身份 = 完整路径（contextName + '.' + symbolName），
 * 例如记录的是 contextName="App"、symbolName="ngOnInit"，
 * 就找路径恰好是 "App.ngOnInit" 的符号。
 *
 * 两阶段查找（按顺序）：
 *   1. 完整路径精确匹配。重名（函数重载）时选离 nearLine 最近的——
 *      日常编辑只造成小位移，最近的几乎一定是它。
 *   2. 兜底：context 里可能有带 '.' 的符号名（如 JS 对象字面量），
 *      按 '.' 切分路径会对不上。这时退化成"全树搜同名 + 离旧行最近"。
 *      误判代价只是偏几行，而误标 stale 会挡住跳转，所以宁可放宽。
 *
 * symbolName 为空或是 '(symbol)'（记录时就没拿到词）→ 直接返回 null。
 * 防御性兜底：正常流程下外层 resolveNodePosition 会先拦下这种情况
 * （按 'unverifiable' 处理），这里再拦一次保证纯函数本身也是安全的。
 *
 * 返回 range.start（定义体起点）而非 selectionRange.start（名字位置）：
 * 当初 F12 落点就是定义位置起点（navigateToNode 跳的正是记下的行列），
 * 保持同一口径，行为才一致。
 *
 * @param nearLine 旧行号（1-based），重名时做"最近"仲裁
 * @returns 1-based 位置，找不到返回 null
 */
export function findSymbolPosition(
  symbols: readonly SymbolLike[],
  symbolName: string,
  contextName: string,
  nearLine: number,
): SymbolPosition | null {
  if (!symbolName || symbolName === '(symbol)') {
    return null;
  }

  // ── 第 1 阶段：完整路径精确匹配 ──
  const wanted = contextName ? `${contextName}.${symbolName}` : symbolName;
  const exact = collectByPath(symbols, [], wanted);
  if (exact.length > 0) {
    return nearest(exact, nearLine);
  }

  // ── 第 2 阶段：兜底，全树搜同名 ──
  // 只有 contextName 非空（即第 1 阶段"本该"能对上却没对上）时才放宽：
  // contextName 为空且第 1 阶段没命中，说明连顶层同名符号都没有，
  // 再放宽也找不到，直接返回 null 即可（下面的 collect 本来就是全树搜，
  // 为空时直接走这里，保持逻辑对称）。
  if (!contextName) {
    return null;
  }
  const byName = collectByName(symbols, symbolName);
  if (byName.length === 0) {
    return null;
  }
  return nearest(byName, nearLine);
}

/**
 * 收集完整路径等于 wanted 的符号起点（0-based 转 1-based 后返回）。
 * path 是从根到父级的路径段（不含自己），递归时逐层累加。
 */
function collectByPath(
  symbols: readonly SymbolLike[],
  path: string[],
  wanted: string,
  out: SymbolPosition[] = [],
): SymbolPosition[] {
  for (const sym of symbols) {
    const full = [...path, sym.name].join('.');
    if (full === wanted) {
      out.push({ line: sym.range.start.line + 1, column: sym.range.start.character + 1 });
    }
    if (sym.children.length > 0) {
      collectByPath(sym.children, [...path, sym.name], wanted, out);
    }
  }
  return out;
}

/** 全树收集所有同名符号的起点（第 2 阶段兜底用）。 */
function collectByName(symbols: readonly SymbolLike[], name: string, out: SymbolPosition[] = []): SymbolPosition[] {
  for (const sym of symbols) {
    if (sym.name === name) {
      out.push({ line: sym.range.start.line + 1, column: sym.range.start.character + 1 });
    }
    if (sym.children.length > 0) {
      collectByName(sym.children, name, out);
    }
  }
  return out;
}

/** 从候选里选离 nearLine 最近的（并列取文档顺序第一个）。 */
function nearest(candidates: SymbolPosition[], nearLine: number): SymbolPosition {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (Math.abs(candidates[i].line - nearLine) < Math.abs(best.line - nearLine)) {
      best = candidates[i];
    }
  }
  return best;
}

/**
 * 递归查找包含 pos 的最深（最具体）符号。
 * 例如光标在函数内的某行，返回该函数符号；在类方法内，返回该方法符号。
 */
function findDeepestEnclosing(symbols: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol | null {
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
function buildContextPath(symbols: vscode.DocumentSymbol[], pos: vscode.Position): string {
  const path: string[] = [];
  findPath(symbols, pos, path);
  return path.join('.');
}

function findPath(symbols: vscode.DocumentSymbol[], pos: vscode.Position, path: string[]): boolean {
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
