import { CoolToolPlugin, CoolToolInterface } from "../src/types"
import { TableRow } from "../src/dataview"
import { msteamsSetupTeam } from "../src/msteams"
import { WaitModal } from "../src/util"
import { ParsingBuffer } from "../src/parsing-buffer"
import { Notice, MarkdownFileInfo, FrontMatterCache} from 'obsidian'
import { getAPI, DataviewApi } from "obsidian-dataview"
import { DataArray } from 'obsidian-dataview/lib/api/data-array'
import { intersection } from "es-toolkit"


export class CoolTool implements CoolToolInterface {
	plugin: CoolToolPlugin
	dv: DataviewApi
	tp: TemplaterPlugin
	templateArgs: { [key: string]: any }
	templatesFolder = "Templates"

	constructor(plugin: CoolToolPlugin) {
		this.plugin = plugin
		this.getDataview()
	}

	// async getTemplater(trynumber:number=1) {
	// 	if (!this.plugin.app.plugins.enabledPlugins.has('templater-obsidian'))
	// 		throw ("Error: Templater plugin not activated.")
	// 	this.tp = this.plugin.app.plugins.plugins['templater-obsidian']
	// 	if (trynumber >= 5)
	// 		throw ("Error: Templater plugin needed for CoolTool.")
	// 	await new Promise(f => setTimeout(f, 500*2^trynumber))
	// 	this.getDataview(++trynumber)
	// }

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

	headers(table: DataArray<string>) {
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

	filterColumns(table: any, predicate: (key: string) => boolean) {
		return table.map((row: TableRow) =>
			Object.keys(row)
				.filter(key => predicate(key))
				.reduce((obj: any, k: string) => {
					obj[k] = row[k]
					return obj
				}, {}))
	}


	// Templates ================================
	async createNote(template: string, args:{[key: string]: any}, noteName:string) {
		const app = this.plugin.app
		const tp = app.plugins.plugins["templater-obsidian"] as TemplaterPlugin
		const templatePath = this.templatesFolder+"/"+template+".md"
		const templateFile = app.vault.getFileByPath(templatePath)
		if (!templateFile) {
			const msg = `Template file "${templatePath}" does not exist.`
			new Notice(msg)
			throw "Error:\n" + msg
		}
		const editor = app.workspace.activeEditor!.editor!
		const text = editor.getValue()
		const match = text.match(new RegExp("```\\s*meta-bind-button[\\s\\S\n]+?\\s+code:\\s*'ct.createNote\\(.+`" + 'Kickoff Minutes <%ct.property\\("Project_ID"\\)%>'  + "`\\)[\\s\\S\n]*?'[\\s\\S\n]*?(```)", ""))
		if (!match) {
			new Notice("ERROR\nCannot find button. You probably changed the button code in an unexpected way.")
			return
		}
		const endOfbuttonPos = editor.offsetToPos(match.index! + match[0].length)
		this.templateArgs = args
		const file = app.workspace.activeEditor!.file!
		this.templateArgs["frontmatter"] = this.plugin.app.metadataCache.getFileCache(file)!.frontmatter!
		noteName = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, noteName)
		const note = await tp.templater.create_new_note_from_template(templateFile, file.parent!, noteName, false)
		editor.replaceRange(`\n[[${note?.basename}]]`, endOfbuttonPos)
		return note
		// tp.templater.create_new_note_from_template(`<% (await tp.file.create_new(tp.file.find_tfile("Minutes"), "MyMinutes", false, tp.file.folder(true))).basename %>`)
	}

	// for context of templates only!
	products(products:string[]): boolean {
		return intersection(products, this.property("Products", this.templateArgs["frontmatter"])).length > 0
	}

	// for context of templates only!
	stages(stages:string[]): boolean {
		return stages.contains(this.templateArgs["stage"])
	}

    // Macros ===================================
	team(heading: string = "Team", buffer?: MarkdownFileInfo): DataArray<string> {
		return new ParsingBuffer(this.plugin, this.dv, buffer).getStakeholders(heading)
	}


    // MsTeams ==================================
    async updateTeamBelow(teamName?: string) {
        const parsed = await new ParsingBuffer(this.plugin, this.dv).parseMsTeam(teamName)
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
    }


    // Tasks ====================================
    property(key: string, frontmatter?: FrontMatterCache): any {
		if (!frontmatter)
			frontmatter = this.plugin.app.metadataCache.getFileCache(this.plugin.app.workspace.activeEditor!.file!)!.frontmatter!
        return frontmatter[key]
    }

    // async linksInFileSection(file:TFile, section?:string): Promise<string[]> {
    //     let text = await this.plugin.app.vault.cachedRead(file)
    //     if (section) {
    //         let match = text.match(new RegExp("\n(#+)\s+" + section + "\s|\n"))
    //         if (!match)
    //             return []
    //         const from = match.index
    //         match = text.match(new RegExp("\n" + "#".repeat(match[1].length) + "\s+"))
    //         text = text.slice(from, match?.index)
    //     }
    //     let match = Array.from(text.matchAll(/\[\[([^\n]+?)(\|([^\n]*?))?\]\]/g))
    //     return match?.map(m => m[1]) || []
    // }

    loggingTrue(...args:any){
        console.log("CT:", ...args)
        return true
    }
}
