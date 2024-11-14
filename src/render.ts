import { CoolToolPlugin, WebpageExportPlugin, MarkdownRendererAPIOptions } from "../src/types"
import { HeadingCache, Component } from 'obsidian'
// import { delay } from 'es-toolkit'


export async function renderBranch(plugin: CoolToolPlugin, line:number, options?: MarkdownRendererAPIOptions): Promise<string|undefined> {
    const app = plugin.app
    const editor = app.workspace.activeEditor!.editor!
    const file = app.workspace.getActiveFile()!
    const headings = app.metadataCache.getFileCache(file)!.headings!
    let index = headings.findLastIndex((h: HeadingCache) => h.position!.start.line <= line)
    let level = -1
    if (index >= 0)
        level = headings[index].level
    let endLine = -1
    while (true) {
        index++
        if (index >= headings.length) {
            endLine = editor.lineCount()
            break
        }
        if (headings[index].level <= level) {
            endLine = headings[index].position.start.line
            break
        }
    }
    const text = editor.getRange({line: line, ch: 0}, {line: endLine, ch: 0})
    // const component = new Component()
    // const container: HTMLElement = new Document().createElement("div")
    // await MarkdownPreviewView.render(app, text, container, file.path, component)
    const whe = (app.plugins.plugins['webpage-html-export'] as WebpageExportPlugin)
    if (!whe)
        throw "webpage-html-export plugin not installed or not activated."
    return whe.api.renderMarkdownToString(text, options)
}
