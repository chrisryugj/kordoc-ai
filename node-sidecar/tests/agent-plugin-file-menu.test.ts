// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-file-menu.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The File menu items the plugin puts into the embedded editor, which leaves out its own Save
 * and Print: what is registered, in which order the items stand, and what clicking one fires.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  FILE_COMMAND_EVENT,
  agentPlugin,
  type AgentPluginHost,
} from '../studio-plugin/agent-plugin.mjs'

const LABELS = {
  save: '저장',
  saveAs: '다른 이름으로 저장…',
  pdf: 'PDF로 내보내기…',
  print: '인쇄…',
}

interface Registered {
  id: string
  label: string
  shortcutLabel?: string
  execute(services: never, params?: never): void
}

function editor(withMenu = true) {
  const commands = new Map<string, Registered>()
  // the File menu as the editor keeps it: commandIds from top to bottom
  const menu = ['file:page-setup', 'file:about']
  const host = {
    read: () => undefined,
    transaction: () => undefined,
    events: { on: () => 0 },
    automation: {
      execute: () => ({ ok: false }),
      registerCommand: (command: Registered) => {
        if (commands.has(command.id)) throw new Error(`already registered: ${command.id}`)
        commands.set(command.id, command)
      },
      addMenuItem: (spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }) => {
        if (!withMenu || spec.menuId !== 'file') throw new Error(`no menu ${spec.menuId}`)
        const at = menu.indexOf(spec.commandId)
        if (at >= 0) menu.splice(at, 1)
        if (spec.position === 'top') menu.unshift(spec.commandId)
        else menu.push(spec.commandId)
      },
    },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), commands, menu }
}

const fired: unknown[] = []
const scope = globalThis as { dispatchEvent?: (event: Event) => boolean }
const original = scope.dispatchEvent
scope.dispatchEvent = (event: Event) => {
  if (event.type === FILE_COMMAND_EVENT) fired.push((event as CustomEvent).detail)
  return true
}

afterEach(() => {
  fired.length = 0
})

describe('the File menu of the embedded editor', () => {
  it('gets Save, Save As, Export as PDF and Print on top, in that order', () => {
    const { plugin, commands, menu } = editor()
    expect(plugin.installFileMenu(LABELS)).toEqual({ ok: true })
    expect(menu).toEqual([
      'ext:kordoc-save',
      'ext:kordoc-save-as',
      'ext:kordoc-export-pdf',
      'ext:kordoc-print',
      'file:page-setup',
      'file:about',
    ])
    expect(commands.get('ext:kordoc-save')).toMatchObject({ label: '저장', shortcutLabel: 'Ctrl+S' })
    expect(commands.get('ext:kordoc-save-as')).toMatchObject({ shortcutLabel: 'Ctrl+Shift+S' })
    expect(commands.get('ext:kordoc-export-pdf')?.shortcutLabel).toBeUndefined()
  })

  it('hands each command to the app as an event on the editor window', () => {
    const { plugin, commands } = editor()
    plugin.installFileMenu(LABELS)
    for (const id of [
      'ext:kordoc-save',
      'ext:kordoc-save-as',
      'ext:kordoc-export-pdf',
      'ext:kordoc-print',
    ]) {
      commands.get(id)?.execute(undefined as never)
    }
    expect(fired).toEqual(['save', 'saveAs', 'pdf', 'print'])
  })

  it('puts the items back once when asked again, without registering twice', () => {
    const { plugin, menu } = editor()
    plugin.installFileMenu(LABELS)
    expect(plugin.installFileMenu(LABELS)).toEqual({ ok: true })
    expect(menu.filter((id) => id.startsWith('ext:'))).toHaveLength(4)
  })

  it('says so when the editor has no File menu, and refuses missing labels', () => {
    expect(editor(false).plugin.installFileMenu(LABELS)).toEqual({ ok: false })
    expect(() => editor().plugin.installFileMenu({ ...LABELS, print: '' })).toThrow(/print/)
  })
})

afterAll(() => {
  if (original === undefined) delete scope.dispatchEvent
  else scope.dispatchEvent = original
})
