import type { CommandDef } from './types';

/** 커맨드 레지스트리: 모든 커맨드 정의를 보관 */
export class CommandRegistry {
  private commands = new Map<string, CommandDef>();

  /** 커맨드 등록. 동일 ID 존재 시 덮어쓴다 (확장 오버라이드용) */
  register(def: CommandDef): void {
    this.commands.set(def.id, def);
  }

  /** 여러 커맨드를 한번에 등록 */
  registerAll(defs: CommandDef[]): void {
    for (const def of defs) this.register(def);
  }

  /** ID로 커맨드 조회. 없으면 undefined */
  get(id: string): CommandDef | undefined {
    return this.commands.get(id);
  }

  /** 카테고리 접두사로 커맨드 목록 조회 (예: "edit") */
  getByCategory(category: string): CommandDef[] {
    const prefix = category + ':';
    const result: CommandDef[] = [];
    for (const [id, def] of this.commands) {
      if (id.startsWith(prefix)) result.push(def);
    }
    return result;
  }

  /** 커맨드 존재 여부 */
  has(id: string): boolean {
    return this.commands.has(id);
  }

  /** 커맨드 제거 (확장 해제용) */
  unregister(id: string): void {
    this.commands.delete(id);
  }

  /** 등록된 모든 커맨드 ID 목록 */
  getAllIds(): string[] {
    return Array.from(this.commands.keys());
  }
}
