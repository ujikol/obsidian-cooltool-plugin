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
import * as fs from 'fs'
import { exec } from 'child_process';
const path = require('path')
const os = require('os')


const CT_PROJECTS_ROOT = "CT_Projects"

export class CoolTool implements CoolToolInterface {
	plugin: CoolToolPlugin
	dv: DataviewApi
	tp: TemplaterPlugin
	templateArgs: { [key: string]: any }
	templatesFolder = "CT_Templates"
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
		// 	new Notice("Active leaf changed!")
		// })
	}

    private getParsingBuffer(path:string, afterInit?: (buf: ParsingBuffer) => void): ParsingBuffer {
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

    isMyTask(task:any, strict = false, me:string[]|string|undefined = undefined): boolean {
        const meArray = !me ? [this.plugin.settings.me] : 
                       typeof me === 'string' ? [me] : me
        let actor = null
        let match = task.description.match(/^@(\w+)/)
        if (match)
            return meArray.includes(match[1])
        actor = task.description.match(/^\[\[(([^\]@]+)\|)?@(.+)\]\]/)
        if (actor) {
            const actorName = actor[2] || actor[3]
            return meArray.some(me => me === actorName)
        }
        return !strict
    }

    // For compatibility with existing notes
    isDelegatedTask(task:any): boolean {
        return !this.isMyTask(task)
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

    cleanMatchcodes(mcs: string[]): string[] {
        return mcs.map(m => {
            const match = m.match(/^\[\[([^\]@]+\|)?@(.+)\]\]/)
            if (match)
                return match[2]
            return m
        })
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
            const text = editor.getValue()
            // const match = text.match(new RegExp("```\\s*meta-bind-button[\\s\\S\n]+?\\s+code:\\s*'ct.createNote\\(.+`" + escapeRegExp(noteName) + "`\\)[\\s\\S\n]*?'[\\s\\S\n]*?(```)", ""))
            // if (!match) {
            //     throw "Cannot find button. You probably changed the button code in an unexpected way."
            // }
            // const endOfbuttonPos = editor.offsetToPos(match.index! + match[0].length)
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
        return this.dv.page(path).file.path;
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
    async importRetain(context: any, projectID: string) {
        const waitModal = new WaitModal(this.plugin.app)
        waitModal.open()
        try {
            if (!projectID)
                projectID = this.property("Project_ID")
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

    // "[Project Folder](file:" + encodeURI(ct.property("Project_Folder")) + ")"
    projectFolder() {
        return "[Project Folder](file:" + encodeURI(this.property("Project_Folder")) + ")"
    }

    // "[Work Folder](file:" + encodeURI(ct.property("Project_Folder") + "/02_Work_in_progress/01_Workdata") + ")"
    workFolder() {
        return "[Work Folder](file:" + encodeURI(this.property("Project_Folder") + "/02_Work_in_progress/01_Workdata") + ")"
    }

    // "[here](file:" + encodeURI(ct.property("Project_Folder") + "/01_PM/01_Permission_to_Attack") + ")"
    ptaFolder() {
        return "[here](file:" + encodeURI(this.property("Project_Folder") + "/01_PM/01_Permission_to_Attack") + ")"
    }

    // "[Final/Deliveryprotocol Folder](file:" + encodeURI(ct.property("Project_Folder") + "/03_Final_deliverables/03_Deliveryprotocol") + ")"
    deliveryProtocolFolder() {
        return "[Final/Deliveryprotocol Folder](file:" + encodeURI(this.property("Project_Folder") + "/03_Final_deliverables/03_Deliveryprotocol") + ")"
    }

    // "[Final/Final Folder](file:" + encodeURI(ct.property("Project_Folder") + "/03_Final_deliverables/01_Final_Report") + ")"
    finalFolder() {
        return "[Final/Final Folder](file:" + encodeURI(this.property("Project_Folder") + "/03_Final_deliverables/01_Final_Report") + ")"
    }

    // "[Decryption Folder](file:" + encodeURI("S:/EMEA/Delivery/" + ct.property("Client")[0] + "/" + ct.property("Client") + "/decrypt") + ")"
    decryptionFolder() {
        return "[Decryption Folder](file:" + encodeURI("S:/EMEA/Delivery/" + this.property("Client")[0] + "/" + this.property("Client") + "/decrypt") + ")"
    }

    // "[[Tasks Tracking " + ct.property("Project_ID") + "|Task Tracking]]"
    taskTracker() {
        return "[[Tasks Tracking " + this.property("Project_ID") + "|Task Tracking]]"
    }

    // '<a href="' + encodeURI('https://secplanner.vie.sec-consult.com/issues/?jql=project = DYPLA AND (summary~' + ct.property("Project_ID") + ' or summary~' + ct.property("Salesforce_ID") + ' or "Project Number"~' + ct.property("Project_ID") + ') ORDER BY updated DESC') + '">DyPla Ticket</a>'
    dyplaTicket() {
        return '<a href="' + encodeURI('https://secplanner.vie.sec-consult.com/issues/?jql=project = DYPLA AND (summary~' + this.property("Project_ID") + ' or summary~' + this.property("Salesforce_ID") + ' or "Project Number"~' + this.property("Project_ID") + ') ORDER BY updated DESC') + '">DyPla Ticket</a>'
    }

    // "[QA Ticket](https:" + encodeURI('secplanner.vie.sec-consult.com/issues/?jql=project = QAD AND (summary~' + ct.property("Project_ID") + ' or summary~' + ct.property("Salesforce_ID") + ' or "Project Number"~' + ct.property("Project_ID") + ') ORDER BY updated DESC') + ")"
    qaTicket() {
        return "[QA Ticket](https:" + encodeURI('secplanner.vie.sec-consult.com/issues/?jql=project = QAD AND (summary~' + this.property("Project_ID") + ' or summary~' + this.property("Salesforce_ID") + ' or "Project Number"~' + this.property("Project_ID") + ') ORDER BY updated DESC') + ")"
    }

    // window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?pid=15300&issuetype=10000&summary=" + ct.property("Project_ID") + " - " + ct.property("Project_Name") + "&customfield_10401=" + ct.property("Project_ID") + "&priority=10100&reporter=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["PM"]))["M/C"]).join(", ") + "&duedate=&customfield_10218=&customfield_24503=" + ct.property("Budget_PD") + "&customfield_15122=11035&customfield_21100=13213&customfield_16802=" + ct.property("Client") + "&customfield_24600=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["ED"]))["M/C"]).join(", ") + "&customfield_24502=" + ct.cleanMatchcodes(ct.team().filter(m => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ") + "&customfield_24501=13200&customfield_26500=" + ct.property("Salesforce_ID") + "&description="))
    createPresalesTicket() {
        return window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?"
        + "pid=15300&issuetype=10000&"
        + "summary=" + this.property("Project_ID") + " - " + this.property("Project_Name")
        + "&customfield_10401=" + this.property("Project_ID")
        + "&priority=10100"
        + "&reporter=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => m.hasRole(["PM"]))["M/C"]).join(", ")
        + "&duedate="
        + "&customfield_10218="
        + "&customfield_24503=" + this.property("Budget_PD")
        + "&customfield_15122=11035"
        + "&customfield_21100=13213"
        + "&customfield_16802=" + this.property("Client")
        + "&customfield_24600=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => m.hasRole(["ED"]))["M/C"]).join(", ")
        + "&customfield_24502=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ")
        + "&customfield_24501=13200"
        + "&customfield_26500=" + this.property("Salesforce_ID")
        + "&description="))
    }

    // 'window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?pid=12500&issuetype=10000&summary=" + ct.property("Project_ID") + " - " + ct.property("Project_Name") + "&customfield_10401=" + ct.property("Project_ID") + "&priority=10100&reporter=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["PM"]))["M/C"]).join(", ") + "&duedate=&customfield_10218=&customfield_24503=" + ct.property("Budget_PD") + "&customfield_15122=11035&customfield_21100=13213&customfield_16802=" + ct.property("Client") + "&customfield_17623=" + ct.property("Project_Folder") + "\\02_Work_in_progress\\02_Final_Report&customfield_24600=" + ct.cleanMatchcodes(ct.team().filter(m => m.hasRole(["ED"]))["M/C"]).join(", ") + "&customfield_24502=" + ct.cleanMatchcodes(ct.team().filter(m => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ") + "&customfield_24501=13200&description="))'
    createQaTicket() {
        return window.open("https://" + encodeURI("secplanner.vie.sec-consult.com/secure/CreateIssueDetails!init.jspa?"
        + "pid=12500&issuetype=10000&"
        + "summary=" + this.property("Project_ID") + " - " + this.property("Project_Name")
        + "&customfield_10401=" + this.property("Project_ID")
        + "&priority=10100"
        + "&reporter=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => m.hasRole(["PM"]))["M/C"]).join(", ")
        + "&duedate="
        + "&customfield_10218="
        + "&customfield_24503=" + this.property("Budget_PD")
        + "&customfield_15122=11035"
        + "&customfield_21100=13213"
        + "&customfield_16802=" + this.property("Client")
        + "&customfield_17623=" + this.property("Project_Folder") + "\\02_Work_in_progress\\02_Final_Report"
        + "&customfield_24600=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => m.hasRole(["ED"]))["M/C"]).join(", ")
        + "&customfield_24502=" + this.cleanMatchcodes(this.team().filter((m: TableRow) => !m.hasRole(["AM", "QA"]))["M/C"]).join(", ")
        + "&customfield_24501=13200"
        + "&description="))
    }

    // window.open("https://" + encodeURI("dypla.vie.sec-consult.com/connector/request/" + ct.property("Project_ID")))
    updatePermissions() {
        return window.open("https://" + encodeURI("dypla.vie.sec-consult.com/connector/request/" + this.property("Project_ID")))
    }

    // window.open("mailto:" + encodeURI("rfp@service.sec-consult.com?cc=" + ct.team().filter(m => !m.hasRole(["PM", "AM", "QA"]))["Email"].join("; ") + "; &subject=RFP " + ct.property("Project_ID") + " Decrypt &for=" + ct.property("Mailbox") + "&body=What:\nS:\\EMEA\\Delivery_Finished\\" + ct.property("Client")[0] + "\\" + ct.property("Client") + "\\\nS:\\EMEA\\Delivery_Finished_Auto\\" + ct.property("Client")[0] + "\\" + ct.property("Client") + "\\\n\rWho: " + ct.team().filter(m => !m.hasRole(["AM", "QA"]))["Name"].join(", ") + "\nPermission: r\nReason: Report needed\nUntil: today + 3 months\n\r@Support: Please add permission(s)"))
    rfpMail() {
        return window.open("mailto:" + encodeURI("rfp@service.sec-consult.com?cc=" + this.team().filter((m: TableRow) => !m.hasRole(["PM", "AM", "QA"]))["Email"].join("; ") + "; &subject=RFP " + this.property("Project_ID") + " Decrypt &for=" + this.property("Mailbox") + "&body=What:\nS:\\EMEA\\Delivery_Finished\\" + this.property("Client")[0] + "\\" + this.property("Client") + "\\\nS:\\EMEA\\Delivery_Finished_Auto\\" + this.property("Client")[0] + "\\" + this.property("Client") + "\\\n\rWho: " + this.team().filter((m: TableRow) => !m.hasRole(["AM", "QA"]))["Name"].join(", ") + "\nPermission: r\nReason: Report needed\nUntil: today + 3 months\n\r@Support: Please add permission(s)"))
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

export async function updateProperties(file: TFile, delay: number = 0) {
    let timeoutId: NodeJS.Timeout | null = null
    let isCancelled = false
  
    return new Promise<void>((resolve) => {
        if (timeoutId) {
            clearTimeout(timeoutId)
            isCancelled = true
        }
        timeoutId = setTimeout(() => {
            if (!isCancelled && file && file.path) {
                actuallyUpdateProperties(file)
                resolve()
            } else {
                resolve()
            }
            timeoutId = null
        }, delay)
    })
}

async function actuallyUpdateProperties(file: TFile) {
    await window.ct.plugin.app.fileManager.processFrontMatter(file, (fm: FrontMatterCache) => {
        const dv = window.ct.dv
        const page = dv.page(file.path)
        if (fm.tags?.indexOf("SEC_Standard_Project") > -1) {
            fm.Status = page.file.tasks.filter((t: any) => [" ", "."].contains(t.status)).length
        }
    })
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
