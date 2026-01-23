import { CoolToolPlugin, CoolToolInterface, TemplaterPlugin } from "../src/types"
import { TableRow } from "../src/dataview"
import { msteamsSetupTeam } from "../src/msteams"
import { WaitModal, convertHtmlToRtf } from "../src/util"
import { ParsingBuffer } from "../src/parsing-buffer"
import { renderBranch} from "../src/render"
import { executePowerShellCommand, pssavpar} from "../src/powershell"
import { monthlyRevenuesTable, monthlyRevenuesChart } from "../src/reporting"
import { App, Command, Modal, Setting , Notice, Editor, MarkdownView, MarkdownFileInfo, TFile, FrontMatterCache} from 'obsidian'
import { getAPI, DataviewApi, Link, DataArray, PageMetadata } from "obsidian-dataview"
import { delay, intersection } from "es-toolkit"
import { getMarkdownTable } from "markdown-table-ts"
import { parseDate } from "chrono-node"
import { RetainAPI } from "./retain"
import { exec } from 'child_process'
import * as path from 'path'
import * as os from 'os'


const CT_PROJECTS_ROOT = "CT_Projects"
// const allActorsRegex = /^(@(?:\w+)|\[\[(?:[^\]@]+\|)?@(?:[^\]]+)\]\])(,\s*(?:@\w+|\[\[(?:[^\]@]+\|)?@(?:[^\]]+)\]\]))*/
const eachActorsRegex =  /^\s*((@(\w+))|(\[\[(CT_People\/Retain\/)?(([^\]]+)(\.md)?\|)?@([^\]]+)\]\])),? */
// const eachActorsRegex = new RegExp(allActorsRegex.toString().slice(1, -1).replace(/\?:/g, ""))

export class CoolTool implements CoolToolInterface {
	plugin: CoolToolPlugin
	dv: DataviewApi
	tp: TemplaterPlugin
	templateArgs: { [key: string]: any }
	templatesFolder = "CT_Templates"
    private parsingBuffers: {[path:string]: ParsingBuffer}
    // updatingProperties: Set<string> = new Set()

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
		// 	new Notice("Active leaf changed!")
		// })
	}

    getParsingBuffer(path:string, afterInit?: (buf: ParsingBuffer) => void): ParsingBuffer {
        this.dv.page(path)
        let buf = this.parsingBuffers[path]
        if (!buf) {
            buf = new ParsingBuffer(this.plugin, this, path)
            this.parsingBuffers[path] = buf
            if (afterInit)
                buf.init().then(() => afterInit(buf))
            else
                buf.init()
        }
        return buf
    }


    // Tasks ====================================

    filterTask(task:any, personalFolders?:string[], sharedFolders?:string[], delegated = false, me:string[]|string|undefined = undefined): boolean {
        const isPersonal = personalFolders?.some(f => task.file.path.startsWith(f))
        const isShared = sharedFolders?.some(f => task.file.path.startsWith(f))
        if (!isPersonal && !isShared)
            return false
        const meArray = !me ? this.plugin.settings.me : 
                       typeof me === 'string' ? [me] : me
        let actors: string[] = []
        var description = task.description
        let match = description.match(eachActorsRegex)
        while (match && match.length > 1) {
            actors.push(match[3] || match[7] || match[9])
            description = description.slice(match[0].length)
            match = description.match(eachActorsRegex)
        }
        const assignedToMe = actors.some(a => meArray.includes(a))
        if (isPersonal) {
            if (!delegated) {
                return assignedToMe || actors.length === 0
            } else {
                return !assignedToMe && actors.length !== 0
            }
        }
        if (isShared) {
            if (assignedToMe)
                return !delegated
            try {
                const pm = this.property("PM", task.file.path)
                let isMyNote = false
                if (pm) {
                    const pmMatches = pm.toString().match(/@(\w+)/g)
                    if (pmMatches) {
                        const pmActors = pmMatches.map((m: string) => m.substring(1))
                        isMyNote = pmActors.some((a: string) => meArray.includes(a))
                    }
                }
                if (!isMyNote) {
                    const tags = this.property("tags", task.file.path)
                    if (tags && typeof Array.isArray(tags) && tags.some((t:string) => meArray.includes(t)))
                        isMyNote = true
                }
                if (!isMyNote)
                    return false
                if (!delegated) 
                    return actors.length === 0
                else
                    return actors.length !== 0
            } catch (err) {
                console.error(err)
                return false
            }
        }
        return false // can never happen; still needed for building
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
		// Convert all cells of table to string and escape unescaped "|"
		if (Array.isArray(table) && table.length > 1 && Array.isArray(table[1])) {
			table[1] = table[1].map((row: any[]) =>
				row.map((cell: any) => {
					let str = cell !== undefined && cell !== null ? String(cell) : "";
					str = str.replace(/(^|[^\\])\|/g, "$1\\|");
					return str;
				})
			)
		}
		return getMarkdownTable({table: {head: table[0], body: table[1]}})
	}


    // Macros ===================================
    property(key: string, path?: string|Link): any {
        if (key === "Project_ID") {
            let value = this.property("Nessie_ID", path)
            if (!value)
                value = this.property("Salesforce_ID", path)
            return value
        }
        path = this.pathFromLink(path)
        const page = this.dv.page(path)
        const value = page[key]
        if (!value) {
            const parent = page.Parent
            if (parent)
                return this.property(key, parent)
        }
        if (key === "Client")
            if (key.startsWith("[[") && key.endsWith("]]"))
                key = key.slice(2, -2)
        return value
    }

	team(heading: string = "Team", path?: string|Link): DataArray<string> {
        return this.stakeholders([heading], path)
	}

	stakeholders(heading: string | string[] = ["Stakeholders"], path?: string|Link): DataArray<string> {
		if (typeof heading === "string")
			heading = [heading]
        path = this.pathFromLink(path)
        const page = this.dv.page(path)
        
        // Check for _table properties first
        let all: DataArray<string> = this.dv.array([])
        // let foundTableProperty = false
        
        for (const h of heading) {
            const tablePropertyName = h + "_table"
            const tableProperty = page[tablePropertyName]
            
            if (tableProperty && Array.isArray(tableProperty)) {
                // Convert YAML objects back to DataArray format
                const tableRows = tableProperty.map((row: any) => {
                    const tableRow = new TableRow()
                    Object.entries(row).forEach(([key, value]) => {
                        tableRow[key] = value
                    })
                    return tableRow
                })
                all = all.concat(this.dv.array(tableRows))
                // foundTableProperty = true
            }
        }
        // // If no _table properties found, fall back to current behavior
        // if (!foundTableProperty) {
        //     const parsingBuffer = this.getParsingBuffer(path)
        //     all = parsingBuffer.getStakeholders(heading[0])
        //     heading.slice(1).forEach((h: string) => {
        //         all = all.concat(parsingBuffer.getStakeholders(h))
        //     })
        // }
        
        const parent = page.Parent
        if (parent) {
            const upper = this.stakeholders(heading, parent)
            if (all.length > 0 && upper.length > 0)
                return upper.concat(all)
            if (upper.length > 0)
                return upper
        }
        return all
	}

    clean(o:any|undefined): any {
        return o ? o : ""
    }

    cleanLinks(link: (string|Link)|(string|Link)[]): string[] {
        if (!Array.isArray(link))
            link = [link]
        return link.map((l: string|Link) => {
            if (typeof l === "object") {
                const display = typeof l.display === 'string' && l.display.startsWith('@') ? l.display.slice(1) : l.display
                if (display && display.length > 0)
                    return display
                else
                    return l.fileName()
            }
            const match = l.match(/^\[\[([^\]@]+\|)?@(.+)\]\]/)
            if (match)
                return match[2]
            return l
        })
    }
    // deprecated (for compatibility with older proejct files)
    cleanMatchcodes(mcs: string[]): string[] {
        return this.cleanLinks(mcs)
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
        const query = `filter by function task.file.path.includes(query.file.path)
        not done
        sort by priority`
        return this.tasks(query, title)
    }
    
	// Templates ===============================
	async createNote(context:any, template: string, noteName:string, args:{[key: string]: any}={}): Promise<TFile | undefined> {
        try {
            const app = this.plugin.app
            const editor = app.workspace.activeEditor!.editor!
            // const text = editor.getValue()
            // const match = text.match(new RegExp("```\\s*meta-bind-button[\\s\\S\n]+?\\s+code:\\s*'ct.createNote\\(.+`" + escapeRegExp(noteName) + "`\\)[\\s\\S\n]*?'[\\s\\S\n]*?(```)", ""))
            // if (!match) {
            //     throw "Cannot find button. You probably changed the button code in an unexpected way."
            // }
            // const endOfbuttonPos = editor.offsetToPos(match.index! + match[0].length)
            // console.log("XXX1 createNote", template, noteName, args)
            const note = await this.createNoteFromTemplate(template, noteName, args)
            if (!note) {
                throw "Note creation failed."
            }
            editor.replaceRange(`[[${note?.basename}]]\n`, {line: context.buttonContext.position.lineEnd + 1, ch: 0})
            return note
        } catch (err) {
			new Notice("ERROR:\n" + err, 30000)
			console.error(err)
        }
	}

    async createNoteFromTemplate(template: string, noteName:string, args:{[key: string]: any}={}): Promise<TFile | undefined> {
		const app = this.plugin.app
		const tp = app.plugins.plugins["templater-obsidian"] as TemplaterPlugin
		const file = app.workspace.activeEditor!.file!
		template = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, template)
		const templatePath = this.templatesFolder+"/"+template+".md"
		const templateFile = app.vault.getFileByPath(templatePath)
		if (!templateFile)
			throw `Template file "${templatePath}" does not exist.`
		this.templateArgs = args
		this.templateArgs["path"] = file.path
        await delay(1001)
		noteName = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, noteName)
        // console.log("XXX1 Creating note from template:", templateFile, file.parent!, noteName)
        await delay(1001)
		const note = await tp.templater.create_new_note_from_template(templateFile, file.parent!, noteName, false)
        // console.log("XXX2 Creating note from template:", note)
		return note
    }

    tracker(who: string[], what: string, priority: number=0, deadline?: string, scheduled?: string): string {
        console.debug("Tracker:", who, what, priority, deadline, scheduled)
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
            console.log("updateTeamBelow", teamName)
            const parsed = await buf.parseMsTeam(teamName)
            if (!parsed) {
                const msg = "Failed to parse note for team update.\n"
                console.error(msg)
                new Notice("ERROR: " + msg)
                return
            }
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
        })
    }

    pathFromLink(path?: string|Link): string {
        if (!path) {
            // Try multiple methods to get the current file path
            const activeFile = 
                // Try active editor first
                (this.plugin.app.workspace.activeEditor?.file) ||
                // Fall back to active file
                this.plugin.app.workspace.getActiveFile() ||
                // If all else fails, try active view
                (this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file);
                
            if (!activeFile) {
                throw new Error("Cannot determine current file path - no active file found");
            }
            return activeFile.path;
        }

        if (this.dv.value.isLink(path)) {
            path = path.path;
        }
        const match = path.match(/^\s*\[\[(.+)(\|.*)?\]\]\s*$/);
        if (match) {
            path = match[1];
        }
        const page = this.dv.page(path)
        if (!page)
            throw new Error(`Cannot find page for path: ${path}`)
        return page.file.path;
    }

    // logTrue(...args:any){
    //     console.log("CT:", ...args)
    //     return true
    // }


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
    async createOutlookItem(context: any, type: string): Promise<{ [key: string]: string } | null> {
        let outlookItem: { [key: string]: string } = {"for":"", "to":"", "cc":"", "deadline":"", "scheduled":""}
        try {
            const html = (await renderBranch(this.plugin, context.buttonContext.position.lineStart))!
            // const parser = new DOMParser()
            // const html = parser.parseFromString(text, 'text/html')
            const firstParagraph = html.getElementsByTagName("p")[0]
            const fields = firstParagraph.innerText
            fields.split("\n").forEach(line => {
                if (line.trim() === "")
                    return
                const [all, key, value] = line.match(/^(\w+):\s?(.*)$/)!
                if (!["for", "from", "to", "cc", "track"].contains(key))
                    throw `Illegal field ${key}`
                if (value)
                    outlookItem[key] = value //.split(/[;,]+/).map(e => e.trim()).join("; ")
            })
            const firstHeading = html.getElementsByTagName("h1")[0]
            outlookItem["subject"] = firstHeading.textContent || ""
            html.removeChild(html.getElementsByClassName("mb-button")[0])
            html.removeChild(firstParagraph)
            html.removeChild(firstHeading)
            outlookItem["body"] = html.innerHTML
        } catch (e) {
            const msg = "Cannot create Email.\nIs the branch structure correct?\n" + e
            console.error(msg)
            new Notice("ERROR: " + msg)
            return null
        }


        let cmd = "$ol = New-Object -comObject Outlook.Application\n"
        cmd += `$item = $ol.CreateItem(${type==="mail" ? 0 : type==="appointment" ? 1 : 3})\n`
        cmd += `$item.Subject = ${pssavpar(outlookItem["subject"])}\n`
        if (type==="mail")
            cmd += `$item.HtmlBody = ${pssavpar(outlookItem["body"])} \n`
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


    // Retain ===================================
    async importRetain(context: any, projectID?: string) {
        const waitModal = new WaitModal(this.plugin.app)
        waitModal.open()
        try {
            if (!projectID)
                projectID = this.property("Project_ID")
            if (!projectID)
                throw "Missing property for Project_ID"
            const insertLine = context.buttonContext.position.lineEnd + 1
            const configPath = path.join(os.homedir(), "retain.json")
            const api = new RetainAPI(configPath)
            new Notice("Importing...\nDo not make any changes until the link was inserted below!")
            const properties = await api.getProjectDataWithBookingsAsMarkdown(projectID)
            if (!properties) {
                new Notice(`Project not found in Retain: ${projectID}`, 7000)
                waitModal.close()
                return
            }
            const note = await this.createNoteFromTemplate("Retain", "Retain " + projectID, properties)
            this.plugin.app.workspace.activeEditor!.editor!.replaceRange(`[[${note!.basename}]]\n`, {line:insertLine, ch:0})
            new Notice("Project imported from Retain.")
        } catch (err) {
            try {
                if (err.startsWith("Error: Command failed: curl")) {
                    new Notice("ERROR:\nConnection to Retain failed.\nIs VPN active?", 10000)
                    // console.log(err) // includes credentials
                }
            } catch {
                new Notice("ERROR:\n" + err)
                console.error(err)
            }
        }
        waitModal.close()
    }


    // Project Creation =========================
    async createProject(projectID: string, importIt: boolean, parent: boolean) {
        try {
            if (importIt) {
                const configPath = path.join(os.homedir(), "retain.json")
                const api = new RetainAPI(configPath)
                new Notice("Importing...")
                const properties = await api.getProjectDataWithBookingsAsMarkdown(projectID)
                if (!properties) {
                    throw `Project not found in Retain: ${projectID}`
                }
                this.templateArgs = properties
            } else
                this.templateArgs = {}
            // let projectCountry: string | undefined
            const match = projectID.match(/^([A-Z]{2})[0-9]{6}/)
            if (match) {
                // projectCountry = match[1]
                this.templateArgs["Nessie_ID"] = projectID
            } else {
                if (!projectID.match(/^[0-9]{10}/))
                    throw `Invalid format for a project ID: ${projectID}`
                this.templateArgs["Salesforce_ID"] = projectID
            }
            const allMdFiles = this.plugin.app.vault.getMarkdownFiles().map(f => f.basename)
            if (allMdFiles.includes(projectID))
                throw `There is already a note with the same name in this vault: ${projectID}`
    		const app = this.plugin.app
            const tp = app.plugins.plugins["templater-obsidian"] as TemplaterPlugin
            const templatePath = this.templatesFolder+"/Project.md"
            const templateFile = app.vault.getFileByPath(templatePath)
            if (!templateFile)
                throw `Template file "${templatePath}" does not exist.`
            this.templateArgs["projectID"] = projectID
            // const projectPath = CT_PROJECTS_ROOT + "/" + (projectCountry ? projectCountry : "Salesforce") + "/" + projectID
            const projectPath = CT_PROJECTS_ROOT + "/Projects/" + projectID
            this.templateArgs["path"] = projectPath
            let note: TFile
            if (parent) {
                const editor = app.workspace.activeEditor!.editor!
                this.templateArgs["parent"] = app.workspace.getActiveFile()!.basename
                editor.replaceRange(`[[${projectID}]]`, editor.getCursor())
                note = (await tp.templater.create_new_note_from_template(templateFile, projectPath, projectID, true))!
            } else {
                note = (await tp.templater.create_new_note_from_template(templateFile, projectPath, projectID, true))!
            }
            tp.templater.create_new_note_from_template(app.vault.getFileByPath(this.templatesFolder+"/Tasks Tracking.md")!, projectPath, "Tasks Tracking " + projectID, false)
            // return note
        } catch (err) {
            console.error(err)
            new Notice("ERROR:\n" + err)
        }
    }


    // People Import ============================
    async importPeople() {
        const configPath = path.join(os.homedir(), "retain.json")
        const api = new RetainAPI(configPath)
        const resources = await api.getAllResources()
        new Notice(`Downloaded ${resources.length} people.`)
        const app = this.plugin.app
        const tp = app.plugins.plugins["templater-obsidian"] as TemplaterPlugin
        const templatePath = this.templatesFolder+"/Resource.md"
        const templateFile = app.vault.getFileByPath(templatePath)!
        for (let r of resources) {
            this.templateArgs = {
                "Name": r.RES_DESCR,
                "MatchCode": r.RES_USRLOGON,
                "Manager": r.RES_MANAGER_RES_ID_DESCR,
                "GCM": r.RES_GCM_ID_DESCR,
                "DAS": r.RES_DASID,
                "Email": r.RES_EMAIL,
                "Location": r.RES_LOC_ID_DESCR,
                "OrgUnit": r.RES_ORG_ID_DESCR}
                try {
                    await app.vault.delete(app.vault.getAbstractFileByPath("CT_People/Retain/" + r.RES_DESCR + ".md")!)
                } catch (e) {}
                const note = (await tp.templater.create_new_note_from_template(templateFile, "CT_People/Retain", r.RES_DESCR, false))
        }
        new Notice(`Imported ${resources.length} people.`)
    }


    // reporting functions ======================

    monthlyRevenuesTable(dv: any, pages: PageMetadata[], from_date?: string, to_date?: string, group?: string | ((p: PageMetadata) => any), sort?: "name" | "total" | "month"): void {
        monthlyRevenuesTable(dv, pages, from_date, to_date, group, sort)
    }

    monthlyRevenuesChart(dv: any, pages: PageMetadata[], from_date?: string, to_date?: string, group?: string | ((p: PageMetadata) => any), sort?: "name" | "total" | "month"): void {
        monthlyRevenuesChart(dv, pages, from_date, to_date, group, sort)
    }


    // Hard code various js elements

    jiraDate(v: string|undefined) { 
        if (!v || v === "" || v === undefined) return ""; 
        const d = new Date(v);
        if (isNaN(d.getTime())) return "";
        const day = d.getDate();
        const month = d.toLocaleString('en-US', { month: 'short' });
        const year = d.getFullYear().toString().slice(2, 4);
        return `${day}/${month}/${year}`; 
    }

    indent() {
        return "<span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>"
    }
    
    // "[Project Folder](file:" + encodeURI(ct.property("Project_Folder")) + ")"
    projectFolder(display: string = "Project Folder", subpath: string = "") {
        return `[${display}](file:${encodeURI(this.property("Project_Folder") + subpath)})`
    }

    // "[Work Folder](file:" + encodeURI(ct.property("Project_Folder") + "/02_Work_in_progress/01_Workdata") + ")"
    workFolder(display: string = "Work Folder") {
        return this.projectFolder(display, "/02_Work_in_progress/01_Workdata")
    }

    // "[PtA Folder](file:" + encodeURI(ct.property("Project_Folder") + "/01_PM/01_Permission_to_Attack") + ")"
    ptaFolder(display: string = "PtA Folder") {
        return this.projectFolder(display, "/01_PM/01_Permission_to_Attack")
    }

    // "[Final/Deliveryprotocol Folder](file:" + encodeURI(ct.property("Project_Folder") + "/03_Final_deliverables/03_Deliveryprotocol") + ")"
    deliveryProtocolFolder(display: string = "Deliveryprotocol Folder") {
        return this.projectFolder(display, "/03_Final_deliverables/03_Deliveryprotocol")
    }

    // "[Final/Final Folder](file:" + encodeURI(ct.property("Project_Folder") + "/03_Final_deliverables/01_Final_Report") + ")"
    finalFolder(display: string = "Final Report Folder") {
        return this.projectFolder(display, "/03_Final_deliverables/01_Final_Report")
    }

    // "[Decryption Folder](file:" + encodeURI("S:/EMEA/Delivery/" + ct.property("Client")[0] + "/" + ct.property("Client") + "/decrypt") + ")"
    decryptionFolder(display: string = "Decryption Folder") {
        return this.projectFolder(display, "/03_Final_deliverables/03_Deliveryprotocol")
    }

    // '<a href="' + encodeURI("https://nextcloud.sec-consult.com/index.php/apps/files/?dir=/" + ct.team().filter(m => m.hasRole(["PM"]))["Email"][0] + "/" + ct.property("Project_ID") + " " + ct.property("Project_Name")) + '">Nextcloud Folder</a>'
    nextcloudFolder(display: string = "Nextcloud Folder") {
        // return '<a href="' + encodeURI("https://nextcloud.sec-consult.com/index.php/apps/files/?dir=/" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Email"][0] + "/" + this.property("Project_ID") + " " + this.property("Project_Name")) + '">' + display + '</a>'
        return `[${display}](${encodeURI("https://nextcloud.sec-consult.com/index.php/apps/files/?dir=/" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Email"][0] + "/" + this.property("Project_ID") + " " + this.property("Project_Name"))})`
    }

    // "[[Tasks Tracking " + ct.property("Project_ID") + "|Task Tracking]]"
    taskTracker(display: string = "Task Tracking") {
        return `[[Tasks Tracking ${this.property("Project_ID")}|${display}]]`
    }

    // '<a href="' + encodeURI('https://secplanner.vie.sec-consult.com/issues/?jql=project = DYPLA AND (summary~' + ct.property("Project_ID") + ' or summary~' + ct.property("Salesforce_ID") + ' or "Project Number"~' + ct.property("Project_ID") + ') ORDER BY updated DESC') + '">DyPla Ticket</a>'
    dyplaTicket(display: string = "DyPla Ticket") {
        // return `<a href="${encodeURI('https://secplanner.vie.sec-consult.com/issues/?jql=project = DYPLA AND (summary~' + this.property("Project_ID") + ' or summary~' + this.property("Salesforce_ID") + ' or "Project Number"~' + this.property("Project_ID") + ') ORDER BY updated DESC')}">${display}</a>`
        return `[${display}](${encodeURI('https://secplanner.vie.sec-consult.com/issues/?jql=project = DYPLA AND (summary~' + this.property("Project_ID") + ' or summary~' + this.property("Salesforce_ID") + ' or "Project Number"~' + this.property("Project_ID") + ') ORDER BY updated DESC')})`
    }

    // "[QA Ticket](https:" + encodeURI('secplanner.vie.sec-consult.com/issues/?jql=project = QAD AND (summary~' + ct.property("Project_ID") + ' or summary~' + ct.property("Salesforce_ID") + ' or "Project Number"~' + ct.property("Project_ID") + ') ORDER BY updated DESC') + ")"
    qaTicket(display: string = "QA Ticket") {
        return `[${display}](https:${encodeURI('secplanner.vie.sec-consult.com/issues/?jql=project = QAD AND (summary~' + this.property("Project_ID") + ' or summary~' + this.property("Salesforce_ID") + ' or "Project Number"~' + this.property("Project_ID") + ') ORDER BY updated DESC')})`
    }

    // window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?pid=15300&issuetype=10000&summary=" + ct.property("Project_ID") + " - " + ct.property("Project_Name") + "&customfield_10401=" + ct.property("Project_ID") + "&priority=10100&reporter=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["PM"]))["M/C"]).join(", ") + "&duedate=&customfield_10218=&customfield_24503=" + ct.property("Budget_PD") + "&customfield_15122=11035&customfield_21100=13213&customfield_16802=" + ct.property("Client") + "&customfield_24600=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["ED"]))["M/C"]).join(", ") + "&customfield_24502=" + ct.cleanMatchcodes(ct.team().filter(m => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ") + "&customfield_24501=13200&customfield_26500=" + ct.property("Salesforce_ID") + "&description="))
    createPresalesTicket() {
        const url = "https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?"
        + "pid=15300&issuetype=10000&"
        + "summary=" + this.property("Project_ID") + " - " + this.property("Project_Name")
        + "&customfield_11704=" + this.cleanLinks(this.team().filter((m: TableRow) => m.hasRole(["AM"]))["M/C"]).join(", ")
        + "&priority=10100"
        + "&duedate="
        + "&customfield_11705=" + this.cleanLinks(this.team().filter((m: TableRow) => m.hasRole(["PM"]))["M/C"]).join(", ")
        + "&customfield_15112=" + this.property("Budget_PD")
        + "&customfield_16802=" + this.cleanLinks(this.property("Client"))
        + "&customfield_24600=" + this.cleanLinks(this.team().filter((m: TableRow) => m.hasRole(["ED"]))["M/C"]).join(", ")
        + "&customfield_24502=" + this.cleanLinks(this.team().filter((m: TableRow) => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ")
        + "&customfield_24501=13200"
        + "&customfield_26500=" + this.property("Salesforce_ID")
        + "&customfield_15114=" + this.jiraDate(this.property("Execution_Start"))
        + "&customfield_15115=" + this.jiraDate(this.property("Execution_End"))
        + "&description=")
        window.open(url)
    }

    // 'window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?pid=12500&issuetype=10000&summary=" + ct.property("Project_ID") + " - " + ct.property("Project_Name") + "&customfield_10401=" + ct.property("Project_ID") + "&priority=10100&reporter=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["PM"]))["M/C"]).join(", ") + "&duedate=&customfield_10218=&customfield_24503=" + ct.property("Budget_PD") + "&customfield_15122=11035&customfield_21100=13213&customfield_16802=" + ct.property("Client") + "&customfield_17623=" + ct.property("Project_Folder") + "\\02_Work_in_progress\\02_Final_Report&customfield_24600=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["ED"]))["M/C"]).join(", ") + "&customfield_24502=" + ct.cleanMatchcodes(ct.team().filter(m => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ") + "&customfield_24501=13200&description="))'
    createQaTicket() {
        return window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?"
        + "pid=12500&issuetype=10000&"
        + "summary=" + this.property("Project_ID") + " - " + this.property("Project_Name")
        + "&customfield_10401=" + this.property("Project_ID")
        + "&priority=10100"
        + "&reporter=" + this.cleanLinks(this.team().filter((m: TableRow) => m.hasRole(["PM"]))["M/C"]).join(", ")
        + "&duedate="
        + "&customfield_10218="
        + "&customfield_24503=" + this.property("Budget_PD")
        + "&customfield_15122=11035"
        + "&customfield_21100=13213"
        + "&customfield_16802=" + this.cleanLinks(this.property("Client"))
        + "&customfield_17623=" + this.property("Project_Folder") + "\\02_Work_in_progress\\02_Final_Report"
        + "&customfield_24600=" + this.cleanLinks(this.team().filter((m: TableRow) => m.hasRole(["ED"]))["M/C"]).join(", ")
        + "&customfield_24502=" + this.cleanLinks(this.team().filter((m: TableRow) => !m.hasRole(["PM", "AM", "QA"]))["M/C"]).join(", ")
        + "&customfield_24501=13200"
        + "&description="))
    }

    // window.open("https://" + encodeURI("dypla.vie.sec-consult.com/connector/request/" + ct.property("Project_ID")))
    updatePermissions() {
        return window.open("https://" + encodeURI("dypla.vie.sec-consult.com/connector/request/" + this.property("Project_ID")))
    }

    // window.open("mailto:" + encodeURI("rfp@service.sec-consult.com?cc=" + ct.team().filter(m => !m.hasRole(["PM", "AM", "QA"]))["Email"].join("; ") + "; &subject=RFP " + ct.property("Project_ID") + " Decrypt &for=" + ct.property("Mailbox") + "&body=What:\nS:\\EMEA\\Delivery_Finished\\" + ct.property("Client")[0] + "\\" + ct.property("Client") + "\\\nS:\\EMEA\\Delivery_Finished_Auto\\" + ct.property("Client")[0] + "\\" + ct.property("Client") + "\\\n\rWho: " + ct.team().filter(m => !m.hasRole(["AM", "QA"]))["Name"].join(", ") + "\nPermission: r\nReason: Report needed\nUntil: today + 3 months\n\r@Support: Please add permission(s)"))
    decryptMail() {
        return window.open("mailto:" + encodeURI("rfp@service.sec-consult.com?cc=" + this.team().filter((m: TableRow) => !m.hasRole(["PM", "AM", "QA"]))["Email"].join("; ") + "; &subject=RFP " + this.property("Project_ID") + " Decrypt &for=" + this.property("Mailbox") + "&body=What:\nS:\\EMEA\\Delivery_Finished\\" + this.cleanLinks(this.property("Client"))[0] + "\\" + this.cleanLinks(this.property("Client")) + "\\\nS:\\EMEA\\Delivery_Finished_Auto\\" + this.cleanLinks(this.property("Client"))[0] + "\\" + this.cleanLinks(this.property("Client")) + "\\\n\rWho: " + this.team().filter((m: TableRow) => !m.hasRole(["AM", "QA"]))["Name"].join(", ") + "\nPermission: r\nReason: Report needed\nUntil: today + 3 months\n\r@Support: Please add permission(s)"))
    }

    // window.open("mailto:" + encodeURI(ct.team().filter(m => !m.hasRole(["PM", "AM"]))["Email"].join("; ") + "?subject=" + ct.property("Project_ID") + " - &for=" + ct.property("Mailbox") + "&body=Hi team,\n\r\n\rBest Regards,\n" + ct.team().filter(m => m.hasRole(["PM"]))["Name"].map(n=>n.split(", ")[1]).join(", ")))
    mailTeam(subject:string = "", body:string = "\n") {
        console.log("XXX1 mailTeam", "mailto:" + encodeURI(this.team().filter((m: TableRow) => !m.hasRole(["PM", "AM"]))["Email"].join("; ") + "?subject=" + this.property("Project_ID") + " - " + subject + "&for=" + this.property("Mailbox") + "&body=Hi team,\n\r" + body + "\n\rBest Regards,\n" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Name"].map((n: string) => n.split(", ")[1]).join(", ")))
        return window.open("mailto:" + encodeURI(this.team().filter((m: TableRow) => !m.hasRole(["PM", "AM"]))["Email"].join("; ") + "?subject=" + this.property("Project_ID") + " - " + subject + "&for=" + this.property("Mailbox") + "&body=Hi team,\n\r" + body + "\n\rBest Regards,\n" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Name"].map((n: string) => n.split(", ")[1]).join(", ")))
    }

    // window.open("mailto:" + encodeURI(ct.team().filter(m => !m.hasRole(["PM", "AM"]))["Email"].join("; ") + "; &subject=" + ct.property("Project_ID") + " New data in work folder&for=" + ct.property("Mailbox") + "&body=Hi team,\n\rI copied new files to " + ct.property("Project_Folder") + "\\02_Work_in_progress\\01_Workdata.\nPlease take a look at them.\n\rBest Regards,\n" + ct.team().filter(m => m.hasRole(["PM"]))["Name"].map(n=>n.split(", ")[1]).join(", ")))
    mailTeamNewData() {
        return this.mailTeam("New data in work folder", `I copied new files to ${this.property("Project_Folder")}\\02_Work_in_progress\\01_Workdata.\nPlease take a look at them.`)
    }

    // window.open("mailto:" + encodeURI(ct.stakeholders("Contacts")["Email"].join("; ") + "?subject=" + ct.property("Project_ID") + " - Delivery of the final project documentation&for=" + ct.property("Mailbox") + "&body=Hello " + ct.stakeholders("Contacts")["Name"].join(", ") + ",\n\rPlease find attached the final report.\n\rPlease confirm reception by simple mail reply.\n\rThank you,\n" + ct.team().filter(m => m.hasRole(["PM"]))["Name"].map(n=>n.split(", ")[1]).join(", ")))
    mailFinalReport() {
        return window.open("mailto:" + encodeURI(this.stakeholders("Contacts")["Email"].join("; ") + "?subject=" + this.property("Project_ID") + " - Delivery of the final project documentation&for=" + this.property("Mailbox") + "&body=Hello " + this.stakeholders("Contacts")["Name"].join(", ") + ",\n\rPlease find attached the final report.\n\rPlease confirm reception by simple mail reply.\n\rThank you,\n" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Name"].map((n: string) => n.split(", ")[1]).join(", ")))
    }

    // window.open("mailto:" + encodeURI("dl-sec-closemail@atos.net?subject=" + "Close Mail " + ct.property("Project_ID") + " - " + ct.property("Client") + " - " + ct.property("Project_Name") + " - " + " - Close Mail&for=" + ct.property("Mailbox") + "&body=Hi BOS,\n\rPlease close project.\n\rBest Regards,\n" + ct.team().filter(m => m.hasRole(["PM"]))["Name"].map(n=>n.split(", ")[1]).join(", ")))
    mailCloseProject() {
        return window.open("mailto:" + encodeURI("dl-sec-closemail@atos.net?subject=" + "Close Mail " + this.property("Project_ID") + " - " + this.cleanLinks(this.property("Client")) + " - " + this.property("Project_Name") + " - Close Mail&for=" + this.property("Mailbox") + "&body=Hi BOS,\n\rPlease close project.\n\rBest Regards,\n" + this.team().filter((m: TableRow) => m.hasRole(["PM"]))["Name"].map((n: string) => n.split(", ")[1]).join(", ")))
    }

    // ct.createNote(context, `Pentest Profile ${ct.property("Language")}`, `Kickoff Agenda ${ct.property("Project_ID")}`, {instructions:true, stage:"Agenda", stakeholdersFilter:(m) => true, stakeholdersColumnsFilter: (c) => ["M/C", "Name", "Role", "Email"].includes(c)})
    createKickoffAgenda(context: any) {
        return this.createNote(context,
            `Pentest Profile ${this.property("Language")}`,
            `Kickoff Agenda ${this.property("Project_ID")}`,
            {
                instructions:true,
                stage:"Agenda",
                stakeholdersFilter:(m: any) => true,
                stakeholdersColumnsFilter: (c: any) => ["M/C", "Name", "Role", "Email"].includes(c)
            })
    }

    // ct.createNote(context, `Pentest Profile ${ct.property("Language")}`, `Kickoff Minutes ${ct.property("Project_ID")}`, {instructions:true, stage:"Kickoff", stakeholdersFilter:(m) => true, stakeholdersColumnsFilter: (c) => ["M/C", "Name", "Role", "Email"].includes(c)})
    createKickoffMinutes(context: any) {
        return this.createNote(context,
            `Pentest Profile ${this.property("Language")}`,
            `Kickoff Minutes ${this.property("Project_ID")}`,
            {
                instructions:true,
                stage:"Kickoff",
                stakeholdersFilter:(m: any) => true,
                stakeholdersColumnsFilter: (c: any) => ["M/C", "Name", "Role", "Email"].includes(c)
            })
    }

    // ct.createNote(context, `AM Briefing`, `AM-PM Briefing ${ct.property("Project_ID")}`, {stakeholdersFilter:m => m.hasRole(["PM", "AM"]), stakeholdersColumnsFilter: (c) => ["M/C", "Name", "Role", "Email"].includes(c)})
    createAMBriefing(context: any) {
        return this.createNote(context,
            `AM Briefing`,
            `AM-PM Briefing ${this.property("Project_ID")}`,
            {stakeholdersFilter: (m: TableRow) => m.hasRole(["PM", "AM"]), stakeholdersColumnsFilter: (c: any) => ["M/C", "Name", "Role", "Email"].includes(c)})
    }

    // ct.createNote(context, "Team Briefing", `Team Briefing ${ct.property("Project_ID")}`)
    createTeamBriefing(context: any) {
        return this.createNote(context,
            "Team Briefing",
            `Team Briefing ${this.property("Project_ID")}`)
    }

    // ct.createNote(context, `Internal Debriefing`, `Internal Debriefing ${ct.property("Project_ID")}`, {stakeholdersFilter:m => m.hasRole(["PM", "AM", "ED", "SL"]), stakeholdersColumnsFilter: (c) => ["M/C", "Name", "Role", "Email"].includes(c)})
    createInternalDebriefing(context: any) {
        return this.createNote(context,
            `Internal Debriefing`,
            `Internal Debriefing ${this.property("Project_ID")}`,
            {stakeholdersFilter: (m: TableRow) => m.hasRole(["PM", "AM", "ED", "SL"]), stakeholdersColumnsFilter: (c: any) => ["M/C", "Name", "Role", "Email"].includes(c)})
    }

    // ct.createNote(context, `Billing Mail`, `Billing Mail ${ct.property("Project_ID")}`)
    createBillingMail(context: any) {
        return this.createNote(context,
            `Billing Mail`,
            `Billing Mail ${this.property("Project_ID")}`)
    }

    // ct.createNote(context, `Clean-up Mail`, `Clean-up Mail ${ct.property("Project_ID")}`)
    createCleanUpMail(context: any) {
        return this.createNote(context,
            `Clean-up Mail`,
            `Clean-up Mail ${this.property("Project_ID")}`)
    }

    // ct.createNote(context, `MsTeams Team`, `MsT Team ${ct.property("Project_ID")}`)
    createMsTeamsTeam(context: any) {
        return this.createNote(context, `MsTeams Team`, `MsT Team ${this.property("Project_ID")}`)
    }

    getActuals(context: any) {
        new Notice("Not yet implemented")
    }

    test() {
        return this.button("Mail Team", 'console.log("mailto:" + encodeURI(ct.team().filter(m => !m.hasRole(["PM", "AM"]))["Email"].join("; ") + "?subject=" + ct.property("Project_ID") + " - &for=" + ct.property("Mailbox") + "&body=Hi team,\\n\\r\\n\\rBest Regards,\\n" + ct.team().filter(m => m.hasRole(["PM"]))["Name"].map(n=>n.split(", ")[1]).join(", ")))')
    }

    button(label: string, code: string) {
        return "```" + `meta-bind-button
style: primary
label: ${label}
actions:
  - type: inlineJS
    code: '${code}'
` + "```"
    }

}

// Import People ================================

export const ImportPeopleCommand = (plugin: CoolToolPlugin): Command => ({
    id: 'import-people',
    name: 'Import people',
    callback: async () => {
        window.ct.importPeople()
    },
})


// Project Creation =============================

export const CreateProjectCommand = (plugin: CoolToolPlugin): Command => ({
    id: 'create-project',
    name: 'Create Project',
    callback: () => {
        new CreateProjectModal(plugin.app, (projectID: string, importIt: boolean, parent: boolean) => {
            window.ct.createProject(projectID.trim(), importIt, parent)
          }).open()
    }
})

export class CreateProjectModal extends Modal {
    constructor(app: App, onSubmit: (projectID: string, importIt: boolean, parent: boolean) => void) {
        super(app)
        this.setTitle('Create Project')
    
        let name = ''
        new Setting(this.contentEl)
            .setName('Project ID')
            .addText((text) =>
            text.onChange((value) => {
                name = value
            }))

            let importIt = true
            new Setting(this.contentEl)
            .setName('Import from Retain')
            .addToggle((toggle) =>
                toggle
                .setValue(importIt)
                .onChange(() => {
                    importIt = !importIt
                }))

                let parent = false
                new Setting(this.contentEl)
                .setName('Belongs to this note')
                .addToggle((toggle) =>
                    toggle
                    .setValue(parent)
                    .onChange(() => {
                        parent = !parent
                    }))
        
        new Setting(this.contentEl)
            .addButton((btn) =>
                btn
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.close()
                    onSubmit(name, importIt, parent)
                }))
            this.scope.register([], "enter", (event: KeyboardEvent) => {
                event.preventDefault()
                event.stopPropagation()
                this.close()
                onSubmit(name, importIt, parent)
            })
    }
}

// Automatic Properties =============================

// Use a global (per-file) timeout map to ensure only one update is scheduled per file.
const updatePropertiesTimeouts: Map<string, NodeJS.Timeout> = new Map()

export async function updateProperties(file: TFile, delay: number = 0) {
    if (!file || !file.path) return

    // If there's already a timeout scheduled for this file, clear it
    const existingTimeout = updatePropertiesTimeouts.get(file.path)
    if (existingTimeout) {
        clearTimeout(existingTimeout)
    }

    // Return a promise that resolves after the update (or immediately if replaced)
    return new Promise<void>((resolve) => {
        const timeoutId = setTimeout(async () => {
            updatePropertiesTimeouts.delete(file.path)
            await actuallyUpdateProperties(file)
            resolve()
        }, delay)
        updatePropertiesTimeouts.set(file.path, timeoutId)
    })
}

async function actuallyUpdateProperties(file: TFile) {
    // Store current editor state before making changes
    const activeEditor = window.ct.plugin.app.workspace.activeEditor
    let cursorPosition: { line: number; ch: number } | null = null
    let isActiveFile = false
    let propertiesChanged = false
    
    if (activeEditor && activeEditor.file?.path === file.path) {
        isActiveFile = true
        cursorPosition = activeEditor.editor?.getCursor() || null
    }
    
    try {
        await window.ct.plugin.app.fileManager.processFrontMatter(file, (fm: FrontMatterCache) => {
            // const dv = window.ct.dv
            // const page = dv.page(file.path)
            // if (fm.tags?.indexOf("SEC_Standard_Project") > -1) {
            //     fm.Status = page.file.tasks.filter((t: any) => [" ", "."].contains(t.status)).length
            // }
            
            // Check for properties with "_table" suffix and parse corresponding headings
            for (const [key, value] of Object.entries(fm)) {
                if (key.endsWith("_table")) {
                    const headingName = key.slice(0, -6) // Remove "_table" suffix
                    try {
                        // Get the parsing buffer for this file
                        const parsingBuffer = window.ct.getParsingBuffer(file.path)
                        const tableData = parsingBuffer.getStakeholders(headingName)
                        
                        // Convert table data to YAML objects
                        const tableRows = tableData.array().map((row: any) => {
                            const yamlObject: { [key: string]: any } = {}
                            Object.entries(row).forEach(([header, cellValue]) => {
                                yamlObject[header] = cellValue
                            })
                            return yamlObject
                        })
                        
                        // Check if the value actually changed
                        const currentValue = JSON.stringify(fm[key])
                        const newValue = JSON.stringify(tableRows)
                        if (currentValue !== newValue) {
                            propertiesChanged = true
                        }
                        
                        // Update the frontmatter property with the parsed table data
                        fm[key] = tableRows
                    } catch (error) {
                        console.warn(`Failed to parse table for heading "${headingName}":`, error)
                    }
                }
            }
        })
        
        // If properties changed, trigger Dataview refresh
        if (propertiesChanged) {
            // Simple approach that works for blocks
            setTimeout(() => {
                try {
                    // Use the Dataview API to force a refresh
                    if (window.ct.dv && window.ct.dv.index) {
                        if (typeof window.ct.dv.index.triggerRefresh === 'function') {
                            window.ct.dv.index.triggerRefresh()
                        }
                    }
                    
                    // Force refresh of all open editors
                    window.ct.plugin.app.workspace.iterateAllLeaves((leaf) => {
                        if (leaf.view.getViewType() === "markdown") {
                            const markdownView = leaf.view as any
                            if (markdownView.editor) {
                                markdownView.editor.refresh()
                            }
                        }
                    })
                } catch (error) {
                    console.warn("Failed to trigger refresh:", error)
                }
            }, 100) // Reduced delay
        }
        
        // Restore editor focus and cursor position if this was the active file
        if (isActiveFile && cursorPosition && activeEditor && !await isEditingProperties(this.app.workspace.getActiveViewOfType(MarkdownView)!)) {
            // Use a small delay to ensure the editor has been refreshed
            setTimeout(() => {
                try {
                    const currentActiveEditor = window.ct.plugin.app.workspace.activeEditor
                    if (currentActiveEditor && currentActiveEditor.file?.path === file.path) {
                        // Restore cursor position and focus
                        // currentActiveEditor.editor?.setCursor(cursorPosition!)
                        currentActiveEditor.editor?.focus()
                        
                        // Alternative approach: trigger a refresh to ensure the editor is properly updated
                        currentActiveEditor.editor?.refresh()
                    }
                } catch (error) {
                    console.warn("Failed to restore editor focus:", error)
                }
            }, 50)
        }
    } finally {
        // Always remove the flag, even if an error occurs
        // window.ct.updatingProperties.delete(file.path)
    }
}

async function isEditingProperties(view: MarkdownView): Promise<boolean> {
    // Check for Visual Properties UI Focus
    // Check if the currently focused DOM element is inside the metadata container
    const activeDoc = view.containerEl.ownerDocument; // Support pop-out windows
    const activeElement = activeDoc.activeElement;

    if (activeElement) {
        // The class 'metadata-container' wraps the Properties UI
        if (activeElement.closest('.metadata-container')) {
            return true;
        }
        // Edge case: The "Add property" button or similar UI elements
        if (activeElement.closest('.metadata-add-button')) {
            return true;
        }
    }
    return false;
}

export const UpdatePropertiesCommand = (plugin: CoolToolPlugin): Command => ({
    id: 'update-properties',
    name: 'Update Properties',
    callback: () => {
        const dv = window.ct.dv
        const file = dv.app.workspace.getActiveFile()
        updateProperties(file)
    }
})


// Update plugins and templates =============================

export const UpdateCommand = (plugin: CoolToolPlugin): Command => ({
    id: 'update',
    name: 'Update',
    callback: async () => {
        new Notice("Updating plugins and templates...")
        gitPull(path.join(plugin.app.vault.adapter.basePath, (window.ct as CoolTool).templatesFolder))
        gitPull(path.join(plugin.app.vault.adapter.basePath, "CT_People"))
        gitPull(path.join(plugin.app.vault.adapter.basePath, "CT_Documentation"))
        plugin.app.commands.executeCommandById('obsidian42-brat:checkForUpdatesAndUpdate')
    },
})

async function gitPull(repoPath: string) {
    try {
        exec(`git -C "${repoPath}" pull`, (error, stdout, stderr) => {
            if (error) {
                console.error(`gitPull ERROR for path: ${repoPath}`, error, stderr);
                new Notice(`Failed to pull repo at: ${repoPath}\n${stderr}`);
            } else {
                console.log(`gitPull SUCCESS for path: ${repoPath}`, stdout);
                new Notice(`Successfully pulled repo at: ${repoPath}`);
            }
        });
    } catch (err) {
        console.error(`gitPull ERROR for path: ${repoPath}`, err);
        new Notice(`Failed to pull repo at: ${repoPath}\n${err}`);
    }
}
