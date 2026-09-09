/**
 * 定义跳转拦截器。
 *
 * 只记录"查定义类"跳转（定义 / 声明 / 实现 / 类型定义），
 * 天然排除 Find 回车、Outline 点击、搜索结果点击等噪音。
 *
 * ── 为什么需要这个文件？（新手必读）──
 *
 * 旧方案（已删除）监听的是"光标动了"事件，用 event.kind === Command 粗筛：
 * F12 和 Find 回车都会让光标动，且 kind 都是 Command，
 * 而 VSCode 并不告诉我们"到底是哪个命令让光标动的"，
 * 所以 Outline / Find / 搜索点击全被误记，污染了导航树。
 *
 * 新方案换一条路蹲点。VSCode 里真正的"查定义"都会经过语言服务的一道关卡：
 * DefinitionProvider / DeclarationProvider /
 * ImplementationProvider / TypeDefinitionProvider（简称"定义全家桶"）。
 * 按下 F12 时，VSCode 会问这些 Provider："这个位置的定义在哪？"
 * 而 Outline 点击、Find 回车、搜索结果点击根本不问它们，而是直接挪光标。
 * 所以：在这道关卡上"记一笔"，就能精确区分两者。
 *
 * ── 和 command-watcher.ts 如何分工？──
 *
 *   1. 用户按 F12 → VSCode 先调用本文件的 provide* 方法
 *      → 我们记下"意图"：谁查的（caller 调用点）+ 查到了哪些目标（targets）。
 *   2. VSCode 跳过去 → 光标动了 → command-watcher.ts 被唤醒
 *      → 它拿着落点来问 consumeIntentIfMatches(落点)。
 *      → 命中才是真跳转，记入 NavTree；没命中（Outline / Find）直接丢弃。
 *
 * 为什么分两步，而不是在第 1 步直接记？
 * Provider 被调用不等于真的跳过去了：多个定义时 VSCode 只弹 Peek 预览，
 * 光标根本不动。第 2 步的"落点确认"能过滤掉这种"只看没跳"的情况。
 */

import * as vscode from 'vscode';
import { CallerPosition } from './nav-tree';

/**
 * 意图有效期（毫秒 = 1 秒）。
 *
 * 时序：Provider 先被调用（第 1 步），selection 事件随后才到（第 2 步），
 * 中间一般只差几十毫秒。1 秒足够覆盖慢机器，
 * 又短到不会把用户稍后的手动跳转误认成定义跳转。
 */
export const DEFINITION_INTENT_WINDOW_MS = 1000;

/**
 * 最多暂存多少条意图。
 *
 * 正常一次 F12 只产生 1 条；快速连按 F12 会攒下几条。
 * 设上限防止极端情况下数组无限增长；超了就丢掉最旧的。
 */
const MAX_STORED_INTENTS = 20;

/**
 * 定义跳转的种类，对应注册的 4 种 Provider。
 *
 * 'definition'      → Go to Definition（F12 / Ctrl+Click）
 * 'declaration'     → Go to Declaration（跳到声明处）
 * 'implementation'  → Go to Implementation（跳到实现处）
 * 'typeDefinition'  → Go to Type Definition（跳到类型定义）
 */
export type DefinitionKind = 'definition' | 'declaration' | 'implementation' | 'typeDefinition';

/**
 * 一个查定义命中的目标位置。
 *
 * 行列都是 1-based（第一行是 1），和 NavNode 保持一致。
 * 为什么不用 VSCode 原生的 0-based？整个 NavTree 对外都用 1-based，
 * 这里统一口径，避免两套编号混用导致的 ±1 bug。
 */
export interface DefinitionTarget {
  uri: string;
  line: number;
  column: number;
}

/**
 * 一次"用户查了定义"的意图。
 *
 * caller  是调用点：provider 收到的 position 参数，也就是用户按 F12 时
 *           光标所在的符号引用位置。天然精确，不需要再猜。
 * targets 是查到的候选目标列表：watcher 用落点来这里"对号入座"。
 * at      是记录时间戳（毫秒）：超过 DEFINITION_INTENT_WINDOW_MS 就过期。
 */
export interface DefinitionIntent {
  kind: DefinitionKind;
  caller: CallerPosition;
  targets: DefinitionTarget[];
  at: number;
}

/**
 * 定义拦截器：在 4 种定义 Provider 上"蹲点"记录意图。
 *
 * 生命周期和 CommandWatcher 对齐：activate() 注册，deactivate() 清理。
 * disposables 的所有权归自己（不经过 context.subscriptions），
 * 和 CommandWatcher 是同一模式：扩展关闭时 extension.ts 的 deactivate()
 * 会调用这里的 deactivate() 统一释放。
 */
export class DefinitionInterceptor {
  /**
   * 已注册的 4 个 Provider 的释放句柄。
   * Disposable 是 VSCode 的"可释放资源"接口：调用 .dispose() 即注销。
   */
  private disposables: vscode.Disposable[] = [];

  /**
   * 防递归守卫。
   *
   * 为什么需要它？handleQuery 内部要用 executeCommand 主动问一遍
   * "真正的定义在哪"，而这个询问会再次经过我们自己注册的 Provider
   * （VSCode 会问"所有" Provider，包括我们），形成无限递归。
   * 为 true 时说明是"自己问自己"，直接返回 null 打断递归。
   */
  private isResolving = false;

  /**
   * 最近的意图列表（按时间从旧到新排列）。
   *
   * 为什么是列表而不是单个变量？用户快速连按两次 F12 时，
   * 第二次查定义可能先于第一次的跳转落点到达；只存一条会丢意图。
   * 存一个小列表 + 逐条消费，就能对上号。
   */
  private recentIntents: DefinitionIntent[] = [];

  /**
   * 注册 4 种定义 Provider，开始记录意图。
   *
   * 选择器 [{ scheme: 'file' }, { scheme: 'untitled' }] 的含义：
   * DocumentFilter 只写 scheme 不写 language = 该 scheme 下所有语言都匹配。
   * file = 磁盘文件，untitled = 没保存的新文件。
   * 没有语言支持的文件也能注册，只是查不到结果 → 不记意图，无副作用。
   *
   * 幂等处理：先 deactivate() 清掉上次注册的，
   * 防止重复调用 activate() 导致一个 F12 记两条意图。
   */
  activate(): void {
    this.deactivate();

    const selector: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }];

    this.disposables.push(
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (document, position, _token) => this.handleQuery('definition', document, position),
      }),
      vscode.languages.registerDeclarationProvider(selector, {
        provideDeclaration: (document, position, _token) => this.handleQuery('declaration', document, position),
      }),
      vscode.languages.registerImplementationProvider(selector, {
        provideImplementation: (document, position, _token) => this.handleQuery('implementation', document, position),
      }),
      vscode.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: (document, position, _token) => this.handleQuery('typeDefinition', document, position),
      }),
    );
  }

  /**
   * 注销所有 Provider 并清空暂存的意图。
   *
   * dispose() 是幂等的（调多次也安全），所以重复调用无妨。
   */
  deactivate(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.recentIntents = [];
  }

  /**
   * 按落点"对号入座"：找到命中的意图就消费掉并返回它，否则返回 null。
   *
   * 由 command-watcher.ts 在防抖确认跳转稳定后调用。
   *
   * 三个细节：
   *   1. 先淘汰过期意图：Peek 预览（只看没跳）留下的意图会在这里被清掉，
   *      所以 Peek 永远不会污染导航树。
   *   2. 从新到旧找：最新的意图最可能是本次跳转的原因。
   *   3. 一次性消费（splice 删掉）：一次 F12 可能触发多个连续的
   *      selection 事件，只让第一个落点记一条，避免重复记。
   *
   * 只比对 uri + line、不比对 column：
   * 落点列理论上等于目标列，但忽略列能容忍各语言服务器的微小差异；
   * 同行不同列的多个重载这种极端情况，可接受误判。
   *
   * @param uri  落点文件 URI（toString 后的字符串，和 target.uri 同口径）
   * @param line 落点行号（1-based，和 target.line 同口径）
   */
  consumeIntentIfMatches(uri: string, line: number): DefinitionIntent | null {
    this.pruneExpired(Date.now());

    for (let i = this.recentIntents.length - 1; i >= 0; i--) {
      const intent = this.recentIntents[i];
      const hit = intent.targets.some((t) => t.uri === uri && t.line === line);
      if (hit) {
        this.recentIntents.splice(i, 1);
        return intent;
      }
    }
    return null;
  }

  /**
   * 测试专用：直接塞一条意图，绕过真正的 Provider。
   *
   * 为什么需要它？单元测试跑在受控环境里，没有语言服务器可查，
   * 用它手工构造"用户刚查过定义"的现场，再测消费逻辑。
   */
  _injectTestIntent(intent: DefinitionIntent): void {
    this.recentIntents.push(intent);
  }

  /** 测试专用：清空所有暂存意图，保证用例之间互不干扰。 */
  _clearIntents(): void {
    this.recentIntents = [];
  }

  /** 测试专用：当前暂存了几条意图（断言用）。 */
  _getIntentCount(): number {
    return this.recentIntents.length;
  }

  /**
   * 4 种 Provider 的统一处理入口。
   *
   * 步骤：
   *   1. 防递归：自己问自己时直接返回 null。
   *   2. 调用点就是 position 参数——用户按 F12 时光标所在的位置，
   *      天然精确。F12 和 Ctrl+Click 在这里没有区别，
   *      所以旧的"Mouse 事件推测调用点"逻辑可以删掉了。
   *   3. 用 executeCommand 问真正的语言服务要结果，记成意图。
   *   4. 返回 null：我们是纯"间谍"，不贡献新结果。
   *      VSCode 会合并"所有" Provider 的结果，原语言服务的结果不受影响；
   *      如果我们把问到的结果再返回，就会造成定义列表里每条出现两次。
   *
   * @returns 永远是 null（见第 4 步）。
   */
  private async handleQuery(
    kind: DefinitionKind,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<null> {
    if (this.isResolving) {
      return null;
    }

    // VSCode 行列是 0-based（第一行是 0），存成 1-based（第一行是 1），
    // 和 NavNode 的口径对齐，跳转时再 -1 还原。
    const caller: CallerPosition = {
      uri: document.uri.toString(),
      line: position.line + 1,
      column: position.character + 1,
    };

    this.isResolving = true;
    try {
      const raw = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        commandIdFor(kind),
        document.uri,
        position,
      );
      this.recordIntent(kind, caller, raw);
    } catch {
      // 查定义失败（比如该语言没装语言服务）→ 当作"没查到"，不记意图。
      // 这里必须留注释：空 catch 是故意的，不是吞异常的 bug。
    } finally {
      // finally 保证即使抛异常也会复位，否则守卫永远卡死，后续 F12 全被吞。
      this.isResolving = false;
    }
    return null;
  }

  /**
   * 把语言服务返回的原始结果记成一条意图。
   *
   * 查无结果（F12 按在没有定义的地方）→ VSCode 不会跳 → 不记。
   * 记之前先淘汰过期意图，再做上限裁剪（超了丢最旧的）。
   */
  private recordIntent(
    kind: DefinitionKind,
    caller: CallerPosition,
    raw: (vscode.Location | vscode.LocationLink)[] | null | undefined,
  ): void {
    if (!raw || raw.length === 0) {
      return;
    }
    this.pruneExpired(Date.now());
    this.recentIntents.push({ kind, caller, targets: raw.map(toTarget), at: Date.now() });
    while (this.recentIntents.length > MAX_STORED_INTENTS) {
      this.recentIntents.shift();
    }
  }

  /** 淘汰过期意图（现在时间 - 记录时间 > 有效期）。 */
  private pruneExpired(now: number): void {
    this.recentIntents = this.recentIntents.filter((i) => now - i.at <= DEFINITION_INTENT_WINDOW_MS);
  }
}

/**
 * 跳转种类 → 对应的"问语言服务"命令 ID。
 *
 * 这些是 VSCode 内置命令：把"文档 + 位置"丢进去，
 * 返回该位置的定义/声明/实现/类型定义列表。
 *
 * default 分支的 `const _exhaustive: never` 是穷尽检查：
 * 将来 DefinitionKind 加了新值却忘了在这里处理，编译会直接报错，
 * 而不是线上静默走错。和 go-forward.ts 的 switch 是同一手法。
 */
function commandIdFor(kind: DefinitionKind): string {
  switch (kind) {
    case 'definition':
      return 'vscode.executeDefinitionProvider';
    case 'declaration':
      return 'vscode.executeDeclarationProvider';
    case 'implementation':
      return 'vscode.executeImplementationProvider';
    case 'typeDefinition':
      return 'vscode.executeTypeDefinitionProvider';
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown definition kind: ${_exhaustive}`);
    }
  }
}

/**
 * 语言服务返回的位置 → 我们存的 1-based 目标。
 *
 * 两种形状要兼容：
 *   Location     有 .uri + .range（老式：直接就是定义位置）
 *   LocationLink 有 .targetUri + .targetRange（新式：还带了原文选取范围等信息）
 * 用 `'targetUri' in loc` 区分：有这个属性就是 LocationLink。
 * 跳转落点永远是目标范围的起点（start），所以只取 start。
 */
function toTarget(loc: vscode.Location | vscode.LocationLink): DefinitionTarget {
  if ('targetUri' in loc) {
    const start = loc.targetRange.start;
    return { uri: loc.targetUri.toString(), line: start.line + 1, column: start.character + 1 };
  }
  const start = loc.range.start;
  return { uri: loc.uri.toString(), line: start.line + 1, column: start.character + 1 };
}
