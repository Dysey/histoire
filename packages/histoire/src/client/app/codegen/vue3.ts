// @ts-nocheck
// @TODO remove no-check and fix vnode type errors

import { VNode, vModelText, vModelCheckbox, vModelSelect, vModelRadio, vModelDynamic } from 'vue'
import { Text } from '@vue/runtime-core'
import { pascal, kebab } from 'case'
import { indent } from './util'
import { serializeJs } from './serialize-js'

export async function generateSourceCode (vnode: VNode | VNode[]) {
  const list = Array.isArray(vnode) ? vnode : [vnode]
  const lines: string[] = []
  for (const vnode of list) {
    lines.push(...await printVNode(vnode))
  }
  return lines.join('\n')
}

async function printVNode (vnode: VNode): Promise<string[]> {
  if (vnode.type === Text) {
    return [vnode.children.trim()]
  }

  const lines: string[] = []

  if (typeof vnode.type === 'object' || typeof vnode.type === 'string') {
    // Wait for async component
    if (vnode.type?.__asyncLoader && !vnode.type.__asyncResolved) {
      await vnode.type.__asyncLoader()
    }

    const attrs: string[][] = []
    let multilineAttrs = false
    const skipProps: string[] = []

    // Directives
    function genDirective (dirName: string, dir, valueCode: string = null) {
      let modifiers = ''
      for (const key in dir.modifiers) {
        if (dir.modifiers[key]) {
          modifiers += `.${key}`
        }
      }
      let arg = ''
      if (dir.arg) {
        arg = `:${dir.arg}`
      }
      const valueLines = valueCode ? [valueCode] : serializeAndCleanJs(dir.value)
      const attr: string[] = []
      const dirAttr = `v-${dirName}${modifiers}${arg}="`
      if (valueLines.length > 1) {
        attr.push(`${dirAttr}${valueLines[0]}`)
        attr.push(...valueLines.slice(1, valueLines.length - 1))
        attr.push(`${valueLines[valueLines.length - 1]}"`)
        multilineAttrs = true
      } else {
        attr.push(`${dirAttr}${valueLines[0] ?? ''}"`)
      }
      attrs.push(attr)
    }
    if (vnode.dirs) {
      for (const dir of vnode.dirs) {
        // Vmodel
        if (dir.dir === vModelText || dir.dir === vModelSelect || dir.dir === vModelRadio || dir.dir === vModelCheckbox || dir.dir === vModelDynamic) {
          const listenerKey = `onUpdate:${dir.arg ?? 'modelValue'}`
          const listener = vnode.props[listenerKey]
          let valueCode: string = null
          if (listener) {
            skipProps.push(listenerKey)
            const listenerSource = listener.toString()
            const result = /\(\$event\) => (.*?) = \$event/.exec(listenerSource)
            if (result) {
              valueCode = result[1]
            }
          }
          genDirective('model', dir, valueCode)
        } else {
          let dirName: string
          for (const directives of [dir.instance._.directives, dir.instance._.appContext.directives]) {
            for (const key in directives) {
              if (dir.instance._.directives[key] === dir.dir) {
                dirName = key
                break
              }
            }
            if (dirName) break
          }
          if (dirName) {
            genDirective(dirName, dir)
          }
        }
      }
    }

    // Attributes
    for (const prop in vnode.props) {
      if (skipProps.includes(prop)) {
        continue
      }
      const value = vnode.props[prop]
      if (typeof value !== 'string' || vnode.dynamicProps?.includes(prop)) {
        let directive = ':'
        if (prop.startsWith('on')) {
          directive = '@'
        }
        const arg = kebab(directive === '@' ? prop.slice(2) : prop)
        const serialized = serializeAndCleanJs(value)
        if (serialized.length > 1) {
          multilineAttrs = true
          const indented: string[] = [`${directive}${arg}="${serialized[0]}`]
          indented.push(...serialized.slice(1, serialized.length - 1))
          indented.push(`${serialized[serialized.length - 1]}"`)
          attrs.push(indented)
        } else {
          attrs.push([`${directive}${arg}="${serialized[0]}"`])
        }
      } else {
        attrs.push([`${kebab(prop)}="${value}"`])
      }
    }
    if (attrs.length > 1) {
      multilineAttrs = true
    }

    // Tags
    const tagName = getTagName(vnode)

    // Children
    const childLines: string[] = []
    if (typeof vnode.children === 'string') {
      childLines.push(vnode.children)
    } else {
      const children: VNode[] = Array.isArray(vnode.children) ? vnode.children : vnode.children?.default?.() ?? []
      for (const child of children) {
        childLines.push(...await printVNode(child))
      }
    }

    // @TODO handle slots

    // Template
    const tag = [`<${tagName}`]
    if (multilineAttrs) {
      for (const attrLines of attrs) {
        tag.push(...indent(attrLines))
      }
      if (childLines.length > 0) {
        tag.push('>')
      }
    } else {
      if (attrs.length === 1) {
        tag[0] += ` ${attrs[0]}`
      }
      if (childLines.length > 0) {
        tag[0] += '>'
      }
    }

    if (childLines.length > 0) {
      lines.push(...tag)
      lines.push(...indent(childLines))
      lines.push(`</${tagName}>`)
    } else if (tag.length > 1) {
      lines.push(...tag)
      lines.push('/>')
    } else {
      lines.push(`${tag[0]} />`)
    }
  }

  return lines
}

function getTagName (vnode: VNode) {
  if (typeof vnode.type === 'string') {
    return vnode.type
  } else if (vnode.type?.__asyncResolved) {
    const asyncComp = vnode.type?.__asyncResolved
    return asyncComp.name ?? getNameFromFile(asyncComp.__file)
  } else if (vnode.type?.name) {
    return vnode.type.name
  } else if (vnode.type?.__file) {
    return getNameFromFile(vnode.type.__file)
  }
  return 'Anonymous'
}

function getNameFromFile (file: string) {
  const parts = /\/([^/]+)\.vue$/.exec(file)
  if (parts) {
    return pascal(parts[1])
  }
  return 'Anonymous'
}

function serializeAndCleanJs (value: any) {
  return serializeJs(value).replace(/\$setup\./g, '').split('\n')
}