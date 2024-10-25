import { CoolToolPlugin, CoolToolInterface, TemplaterPlugin } from "../src/types"
import { TableRow } from "../src/dataview"
import { msteamsSetupTeam } from "../src/msteams"
import { WaitModal, convertHtmlToRtf } from "../src/util"
import { ParsingBuffer } from "../src/parsing-buffer"
import { renderBranch} from "../src/render"
import { executePowerShellCommand, pssavpar} from "../src/powershell"
import { Notice, Editor, MarkdownView, MarkdownFileInfo} from 'obsidian'
import { getAPI, DataviewApi, Link, DataArray } from "obsidian-dataview"
import { intersection, escapeRegExp } from "es-toolkit"
import { getMarkdownTable } from "markdown-table-ts"
import { parseDate } from "chrono-node"


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


    // Tasks ====================================

    isDelegatedTask(task:any): boolean {
        let actor = null
        let match = task.description.match(/^\[\[([^\]@]+\|)?@(.+)\]\]/)
        if (match)
            actor = match[2]
        match = task.description.match(/^@(\w+)/)
        if (match)
            actor = match[1]
        if (!actor)
            return false
        return (actor !== process.env.MATCH_CODE)
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
		if (trynumber >= 10)
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

    callout(text: string, type: string="", title: string = ""): string {
        const allText = `> [!${type}] ${title}\n` + text
        const lines = allText.split('\n')
        return lines.join('\n> ') + '\n'
    }

    tasks(query: string, title:string): string {
        return this.callout('```tasks\n' + query + '\n```', "todo", title)
    }

    actionPlan(title:string="Agreed Tasks"): string {
        const query = `
            path includes {{query.file.path}}
            sort by priority
        `
        return this.tasks(query, title)
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

    tracker(who: string[], what: string, priority: number=0, deadline?: string, scheduled?: string): string {
        let prio = ["", " ⏬", " 🔽", " 🔼", " ⏫", " 🔺"][priority]
        const parseDateOption = { forwardDate: true }
        let tasks = ""
        who.forEach(w => {
            let task = "- [ ] " + w + ": " + what + prio
            if (deadline)
                task += " 📅 " + window.moment(parseDate(deadline, undefined, parseDateOption)).format("YYYY-MM-DD")
            if (scheduled)
                task += " ⏳ " + window.moment(parseDate(scheduled, undefined, parseDateOption)).format("YYYY-MM-DD")
            tasks += task + "\n"
        })
        return tasks
    }

    insert(text:string, line:number) {
        this.plugin.app.workspace.activeEditor!.editor!.replaceRange(text, {line: line, ch:0})
    }

	// for context of templates only!
	products(products:string[]): boolean {
		return intersection(products, this.property("Products", this.templateArgs["path"])).length > 0
	}

	// for context of templates only!
	stages(stages:string[]): boolean {
		return stages.contains(this.templateArgs["stage"])
	}

	// for context of templates only!
	withInstructions(): boolean {
		return this.templateArgs["instructions"]
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


    // HTML renderer ============================
	// async getWebpageHtmlExport(trynumber:number=1) {
	// 	const whe = this.plugin.app.plugins.plugins["webpage-html-export"]
	// 	if (whe) {
	// 		if (!this.plugin.app.plugins.enabledPlugins.has('webpage-html-export'))
	// 			throw ("Error: Webpage-Html-Export plugin not activated.")
	// 		this.whe = whe.api
	// 		return
	// 	}
	// 	if (trynumber >= 10)
	// 		throw ("Error: Webpage-Html-Export plugin needed for CoolTool.")
	// 	await new Promise(f => setTimeout(f, 500*2^trynumber))
	// 	this.getWebpageHtmlExport(++trynumber)
	// }


    // Outlook ==================================
    async createOutlookItem(context: any, type: string): Promise<{ [key: string]: string }> {
        let outlookItem: { [key: string]: string } = {"for":"", "to":"", "cc":"", "deadline":"", "scheduled":""}
        try {
            const text = (await renderBranch(this.plugin, context.buttonContext.position.lineStart))!
            const parser = new DOMParser()
            const html = parser.parseFromString(text, 'text/html')
            const fields = html.getElementsByTagName("p")[0].innerText
            fields.split("\n").forEach(line => {
                const [all, key, value] = line.match(/^(\w+):\s?(.*)$/)!
                // if (!["for", "from", "to", "cc"].contains(key))
                //     throw `Illegal field ${key}`
                outlookItem[key] = value.split(/[;,]+/).map(e => e.trim()).join("; ")
            })
            outlookItem["subject"] = html.getElementsByClassName("heading")[0].textContent || ""
            outlookItem["body"] = html.getElementsByClassName("heading-children")[0].innerHTML
        } catch (e) {
            const msg = "ERROR: Cannot create Email.\nIs the branch structure correct?\n" + e
            console.log(msg)
            new Notice(msg)
        }
        let cmd = "$ol = New-Object -comObject Outlook.Application\n"
        cmd += `$item = $ol.CreateItem(${type==="mail" ? 0 : type==="appointment" ? 1 : 3})\n`
        cmd += `$item.Subject = '${outlookItem["subject"]}'\n`
        if (type==="mail")
            cmd += `$item.HtmlBody = ${pssavpar(outlookItem["body"])}\n`
        else
            cmd += `$item.Body = ${pssavpar(convertHtmlToRtf(outlookItem["body"])!)}\n`
        cmd += `$item.${type==="task" ? "Delegator" : "SentOnBehalfOfName"} = '${outlookItem["for"]}'\n`
        cmd += `$item.${type==="mail" ? "to" : type==="appointment" ? "RequiredAttendees" : "Owner"} = '${outlookItem["to"]}'\n`
        cmd += `$item.${type==="appointment" ? "OptionalAttendees" : "cc"} = '${outlookItem["cc"]}'\n`
        cmd += `$item.DueDate = '${outlookItem["deadline"]}'\n`
        cmd += `$item.ReminderTime = '${outlookItem["scheduled"]}'\n`
        cmd += "$inspector = $item.GetInspector\n$inspector.Display()\nStart-Sleep -Seconds 2\n$inspector.Activate()\n"
        executePowerShellCommand(cmd)
        return outlookItem
    }

}
