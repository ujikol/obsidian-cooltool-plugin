import { CoolToolPlugin, CoolToolInterface } from "../src/types"
import { TableRow } from "../src/dataview"
import { msteamsSetupTeam } from "../src/msteams"
import { WaitModal } from "../src/util"
import { ParsingBuffer } from "../src/parsing-buffer"
import { Notice, Editor, MarkdownView, MarkdownFileInfo} from 'obsidian'
import { getAPI, DataviewApi, Link, DataArray } from "obsidian-dataview"
import { intersection, escapeRegExp } from "es-toolkit"
import { getMarkdownTable } from "markdown-table-ts"


export class CoolTool implements CoolToolInterface {
	plugin: CoolToolPlugin
	dv: DataviewApi
	tp: TemplaterPlugin
	templateArgs: { [key: string]: any }
	templatesFolder = "Templates"
    private parsingBuffers: {[path:string]: ParsingBuffer}

	constructor(plugin: CoolToolPlugin) {
		this.plugin = plugin
		this.getDataview()
        this.parsingBuffers = {}
        this.plugin.app.workspace.on('editor-change', (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
            const path = info.file!.path
            if (!(path in this.parsingBuffers))
                return 
            delete this.parsingBuffers[path]
            // Needed ???????????????????????????????
            // this.parsingBuffers[path] = this.getParsingBuffer(path)
        })
        // this.plugin.app.workspace.on("active-leaf-change", () => {
		// 	console.log("XXX6 Active leaf changed!")
		// 	new Notice("Active leaf changed!")
		// })
	}

    private getParsingBuffer(path:string, afterInit?: (buf: ParsingBuffer) => void): ParsingBuffer {
        let buf = this.parsingBuffers[path]
        if (!buf) {
            buf = new ParsingBuffer(this.plugin, this)
            this.parsingBuffers[path] = buf
            if (afterInit)
                buf.init(path).then(() => afterInit(buf))
            else
                buf.init(path)
        }
        return buf
    }

    // DataView =================================
	async getDataview(trynumber:number=1) {
		const dv = getAPI(this.plugin.app)
		if (dv) {
			if (!this.plugin.app.plugins.enabledPlugins.has('dataview'))
				throw ("Error: Dataview plugin not activated.")
			this.dv = dv
			return
		}
		if (trynumber >= 5)
			throw ("Error: Dataview plugin needed for CoolTool.")
		await new Promise(f => setTimeout(f, 500*2^trynumber))
		this.getDataview(++trynumber)
	}

	headers(table: DataArray<any>): string[] {
		if (table.length === 0)
			return []
		return Object.getOwnPropertyNames(table[0])
	}

	asArray(table: any) {
		const headers = this.headers(table)
		return [headers].concat(
			[table.array().map((r: TableRow) => {
				return Object.entries(r).map(([k, v]: [string, any]) => {
					return v
				})
			})]
		)
	}

	filterColumns(table: any, filter: string[] | ((key: string) => boolean)) {
		return table.map((row: TableRow) =>
			Object.keys(row)
				.filter(key => Array.isArray(filter) ?
                    filter.contains(key) :
                    filter(key))
				.reduce((obj: any, k: string) => {
					obj[k] = row[k]
					return obj
				}, {}))
	}

	addColumns(table: any, columns: {name: string, value?: string}[]): DataArray<any> {
		return table.map((row: TableRow) => {
			columns.forEach(c => {
				row[c.name as keyof typeof row] = c.value
			})
			return row
		})
	}

	markdown(table: any): string {
		if ("array" in table)
			table = this.asArray(table)
		return getMarkdownTable({table: {head: table[0], body: table[1]}})
	}


    // Macros ===================================
    property(key: string, path?: string|Link): any {
        path = this.pathFromLink(path)
        const page = this.dv.page(path)
        const value = page[key]
        if (!value) {
            const parent = page.Parent
            if (parent)
                return this.property(key, parent)
        }
        return value
    }

	team(heading: string = "Team", path?: string|Link): DataArray<string> {
        return this.stakeholders([heading], path)
	}

	stakeholders(heading: string | string[] = ["Stakeholders"], path?: string|Link): DataArray<string> {
		if (typeof heading === "string")
			heading = [heading]
        path = this.pathFromLink(path)
		const parsingBuffer = this.getParsingBuffer(path)
		let all: DataArray<string> = []
        const page = this.dv.page(path)
        const parent = page.Parent
        all = parsingBuffer.getStakeholders(heading[0])
		heading.slice(1).forEach((h: string) => {
			all = all.concat(parsingBuffer.getStakeholders(h))
		})
        if (parent) {
            const upper = this.stakeholders(heading, parent)
            if (all.length > 0 && upper.length > 0)
                return upper.concat(all)
            if (upper.length > 0)
                return upper
        }
        return all
	}


	// Templates ===============================
	async createNote(template: string, args:{[key: string]: any}, noteName:string) {
		const app = this.plugin.app
		const tp = app.plugins.plugins["templater-obsidian"] as TemplaterPlugin
		const file = app.workspace.activeEditor!.file!
		template = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, template)
		const templatePath = this.templatesFolder+"/"+template+".md"
		const templateFile = app.vault.getFileByPath(templatePath)
		if (!templateFile) {
			const msg = `Template file "${templatePath}" does not exist.`
			new Notice(msg)
			throw "Error:\n" + msg
		}
		const editor = app.workspace.activeEditor!.editor!
		const text = editor.getValue()
		const match = text.match(new RegExp("```\\s*meta-bind-button[\\s\\S\n]+?\\s+code:\\s*'ct.createNote\\(.+`" + escapeRegExp(noteName)  + "`\\)[\\s\\S\n]*?'[\\s\\S\n]*?(```)", ""))
		if (!match) {
			new Notice("ERROR\nCannot find button. You probably changed the button code in an unexpected way.")
			return
		}
		const endOfbuttonPos = editor.offsetToPos(match.index! + match[0].length)
		this.templateArgs = args
		this.templateArgs["path"] = file.path
		noteName = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, noteName)
		const note = await tp.templater.create_new_note_from_template(templateFile, file.parent!, noteName, false)
        if (!note) {
            new Notice(`ERROR: Note creation failed. Check log!`)
            return
        }
		editor.replaceRange(`\n[[${note?.basename}]]`, endOfbuttonPos)
		return note
	}

	// for context of templates only!
	products(products:string[]): boolean {
		return intersection(products, this.property("Products", this.templateArgs["path"])).length > 0
	}

	// for context of templates only!
	stages(stages:string[]): boolean {
		return stages.contains(this.templateArgs["stage"])
	}


    // MsTeams ==================================
    async updateTeamBelow(teamName?: string) {
        this.getParsingBuffer(this.pathFromLink(undefined), async (buf) => {
            const parsed = await buf.parseMsTeam(teamName)
            if (parsed) {
                const [team, idInsertLine] = parsed
                if (idInsertLine)
                    new Notice("Confirm login!.\nDo not make any changes until you receive a confirmation that the team was updated!", 7000)
                else
                    new Notice("Confirm login and be patient!\nMsTeam may need quite a few seconds to create a new team.\nDo not make any changes until you receive a confirmation that the team was created!", 15000)
                const waitModal = new WaitModal(this.plugin.app)
                waitModal.open()
                const [success, id, output] = await msteamsSetupTeam(team)
                if (id && idInsertLine)
                    this.plugin.app.workspace.activeEditor!.editor!.replaceRange(`:ID: ${id}\n`, {line:idInsertLine!, ch:0})
                if (success)
                    new Notice("Creation/Update succeeded.")
                else
                    new Notice("Creation/Update failed:\n" + output)
                waitModal.close()
            }
        })
    }

    pathFromLink(path?: string|Link): string {
        if (!path)
            return this.plugin.app.workspace.activeEditor!.file!.path
        if (this.dv.value.isLink(path))
            path = path.path
        const match = path.match(/^\s*\[\[(.+)(\|.*)?\]\]\s*$/)
        if (match)
            path = match[1]
        return this.dv.page(path).file.path
    }

    logTrue(...args:any){
        console.log("CT:", ...args)
        return true
    }
}
