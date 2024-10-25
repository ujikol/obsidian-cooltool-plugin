import { CoolToolPlugin, MsTeamsTeam, MsTeamsOptions, MsTeamsChannel } from "../src/types"
import { TableRow } from "../src/dataview"
import { replaceAsync } from "../src/util"
import { Notice, HeadingCache, SectionCache } from 'obsidian'
import { DataArray } from "obsidian-dataview"
import { delay } from 'es-toolkit'
import { CoolTool } from "./cooltool"


export class ParsingBuffer {
	plugin: CoolToolPlugin
	headings: HeadingCache[]
	sections: SectionCache[]
	text: string
	ct: CoolTool

	constructor(plugin: CoolToolPlugin, ct: CoolTool) {
		this.plugin = plugin
		this.ct = ct
    }

    async init(path: string) {
		const app = this.plugin.app
        const file = app.vault.getFileByPath(path)!
        const cache = app.metadataCache.getFileCache(file)!
        // const cache = app.metadataCache.metadataCache[app.metadataCache.fileCache[path].hash]
		this.text = path === app.workspace.getActiveFile()?.path ? app.workspace.activeEditor!.editor!.getValue() : await app.vault.cachedRead(file)
		this.sections = cache.sections!
		this.headings = cache.headings!
	}

	getStakeholders(heading: string): DataArray<string> {
        const table_heading = this.headings.find((h: HeadingCache) => h.heading === heading)
        if (!table_heading)
            return this.ct.dv.array([])
        let i = -1
        while (++i < this.sections.length) {
            if (this.sections[i].type === "heading" && this.sections[i].position.start.offset === table_heading.position.start.offset) {
                if (++i < this.sections.length && this.sections[i].type === "table") {
                    return this.ct.dv.array(this.parseTable(this.text.slice(this.sections[i].position.start.offset)))
                }
            }
        }
        return []
    }

    parseTable(markdown: string): TableRow[] {
        let rows = markdown.trim().split('\n')
        rows = rows.slice(0, rows.findIndex(r => !r.startsWith("| ")))
        const headers = rows[0].split('|').map(header => header.trim()).filter(Boolean)
        const dataRows = rows.slice(2)
        const parsedRows = dataRows.map(row => {
            const cells = (" " + row + " ").split(' | ')
                .map(cell => cell.trim())
            if (cells.length === 0)
                return null
            const rowObject: TableRow = new TableRow()
            headers.forEach((header, index) => {
                rowObject[header] = cells[index + 1]
            })
            return rowObject
        })
        return parsedRows.filter(r => r !== null)
    }

	async parseMsTeam(teamName?: string): Promise<[MsTeamsTeam, number|null] | undefined> {
		try {
            const editor = this.plugin.app.workspace.activeEditor!.editor!
			let index: number
			if (teamName) {
				index = this.headings.findIndex(async (h: HeadingCache) => await this.expandedText(h.heading) === teamName)
				if (index < 0)
					throw `Error: Cannot find team heading ${teamName}.`
			} else {
				// Hope on "fix" of meta-bind plugin to provide notePosition for runInlineJsAction
				let cursor = editor.getCursor()
				const buttonLines = this.sections.filter((s: SectionCache) =>
						s.type === "code" &&
						this.text.slice(s.position.start.offset, s.position.end.offset)
							.contains("label: Update team")
					).map((b: SectionCache) => b.position.start.line)
				const lineDiffs = buttonLines.map(l => (l <= cursor.line + 1) ? l - cursor.line : Number.MAX_SAFE_INTEGER)
				const buttonLine = buttonLines[lineDiffs.indexOf(Math.min(...lineDiffs))]
				index = this.headings.findLastIndex((h: HeadingCache) => h.position!.start.line <= buttonLine)
				if (index < 0)
					throw `Error: Cannot find team heading (with button below) in context of cursor line ${cursor.line}.`
				teamName = await this.expandedText(this.headings[index].heading)
			}
			const teamLevel = this.headings[index].level
			const [description, options] = this.parseOptionsSection(await this.getSectionText(index, teamLevel))
			const id = options["ID"]
			delete options["ID"]
			const idInsertLine = id ? null : this.headings[index].position.start.line + 1
			const owners = this.parseUserSection(await this.getSectionText(++index, teamLevel + 1, "Owner"))
			const members = this.parseUserSection(await this.getSectionText(++index, teamLevel + 1, "Member"))
			const channels: MsTeamsChannel[]= []
			while (++index < this.headings.length && this.headings[index].level === teamLevel + 1) {
				const channelName = await this.expandedText(this.headings[index].heading)
				let [description, options] = this.parseOptionsSection(await this.getSectionText(index, teamLevel + 1))
				let membershipType = "Standard"
				let owners: string[] = []
				let members: string[] = []
				if (index + 1 < this.headings.length && this.headings[index + 1].level === teamLevel + 2) {
					membershipType = "Private"
					owners = this.parseUserSection(await this.getSectionText(++index, teamLevel + 2, "Owner"))
					members = this.parseUserSection(await this.getSectionText(++index, teamLevel + 2, "Member"))
				}
				channels.push({displayName: channelName, description: description, membershipType: membershipType, options: options, owners: owners, members: members})
			}
			let team: MsTeamsTeam = {
				id: id as string | null,
				displayName: teamName,
				description: description,
				options: options,
				owners: owners,
				members: members,
				channels: channels
			}
			return [team, idInsertLine]
		} catch (err: unknown) {
			new Notice(err as string)
		}
	}

	async getSectionText(index: number, level: number, prefix?: string): Promise<string> {
		if (index >= this.headings.length)
			throw (`Error: Expected heading ${prefix} at level ${level} but reached end of text`)
		const heading = this.headings[index]
		if (heading.level !== level || (prefix && !heading.heading.startsWith(prefix)))
			throw (`Error: Expected heading ${prefix} at level ${level} but got heading ${heading.heading} at level ${heading.level}`)
        const editor = this.plugin.app.workspace.activeEditor!.editor!
		const text = this.text.slice(editor.posToOffset({line: heading.position.start.line + 1, ch:0}),
				index < this.headings.length ? editor.posToOffset({line: this.headings[index + 1].position.start.line, ch:0}) : this.text.length)
		return await this.expandedText(text)
	}

	parseOptionsSection(description: string): [string, MsTeamsOptions] {
		let options: MsTeamsOptions = {}
		description = description.replace(/ *```(.|[\r\n])+``` */g, "")
		description = description.replace(/^ *:(\w+): *([^ \n]+) *\n/, (all, key, value) => {
			options[key] = value
			return ""
		}).replace("\n", " ").trim()
		return [description, options]
	}

	parseUserSection(text: string): string[] {
		const emailRegex = /(([^<>()[\]\.,;:\s@\"]+(\.[^<>()[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})/ig
		let emails: string[] = text.toLowerCase().match(emailRegex) || []
		return [... new Set(emails)]
	}

	async expandedText(text: string): Promise<string> {
		const blockRegex = /```dataviewjs\n([\s\S]*?)```/g;
		const inlineRegex = /`\$=([\s\S]*?)`/g;
		text = await replaceAsync(text, blockRegex, async (match, code): Promise<string> => {
			const container: HTMLElement = new Document().createElement("div")
			container.onNodeInserted = (listener: () => any,  once?: boolean | undefined) => () => {}
			await this.ct.dv.executeJs(code, container, this.plugin, this.plugin.app.workspace.activeEditor!.file?.path)
			await delay(1001)
			const result = container.innerHTML
			return result
		})
		text = text.replace(inlineRegex, (match, code): string => {
			const container: HTMLElement = new Document().createElement("span")
			container.onNodeInserted = (listener: () => any,  once?: boolean | undefined) => () => {}
			let result = function () {
				return eval("const dataview = this.ct.dv;const dv=this.ct.dv;" + code)
			}.call({index:this.ct.dv.index, component:this.plugin, container:container, app:this.plugin.app, settings:this.ct.dv.settings, currentFilePath:this.plugin.app.workspace.activeEditor!.file!.path})
			return result
		})
		return text
	}

}
