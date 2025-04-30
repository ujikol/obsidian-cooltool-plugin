import { CoolToolPlugin, CoolToolSettings, CoolToolInterface, TemplaterPlugin } from "../src/types"
import { TableRow } from "../src/dataview"
import { msteamsSetupTeam } from "../src/msteams"
import { WaitModal, convertHtmlToRtf } from "../src/util"
import { ParsingBuffer } from "../src/parsing-buffer"
import { renderBranch} from "../src/render"
import { executePowerShellCommand, pssavpar} from "../src/powershell"
import { App, Command, Modal, Setting , Notice, Editor, MarkdownView, MarkdownFileInfo, TFile, FrontMatterCache} from 'obsidian'
import { getAPI, DataviewApi, Link, DataArray, PageMetadata } from "obsidian-dataview"
import { intersection, escapeRegExp } from "es-toolkit"
import { getMarkdownTable, Align } from "markdown-table-ts"
import { parseDate } from "chrono-node"
import { RetainAPI } from "./retain"
const path = require('path')
const os = require('os')


const CT_PROJECTS_ROOT = "CT_Projects"

export class CoolTool implements CoolToolInterface {
	plugin: CoolToolPlugin
	dv: DataviewApi
	tp: TemplaterPlugin
	templateArgs: { [key: string]: any }
	templatesFolder = "CT_Projects/Templates"
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

    isDelegatedTask(task:any, me?:string[]): boolean {
        if (!me)
            me = this.plugin.settings.me
        let actor = null
        let match = task.description.match(/^@(\w+)/)
        if (match)
            return !me.includes(match[1])
        match = task.description.match(/^\[\[(([^\]@]+)\|)?@(.+)\]\]/)
        if (match)
            return !(me.includes(match[2]) || me.includes(match[3]))
        return false
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
        const query = `
            filter by function task.file.path.includes(query.file.path)
            sort by priority
        `
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
		noteName = await tp.templater.parse_template({template_file: undefined, target_file: file, run_mode: "AppendActiveFile", active_file: file}, noteName)
		const note = await tp.templater.create_new_note_from_template(templateFile, file.parent!, noteName, false)
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
            if (err.startsWith("Error: Command failed: curl")) {
                new Notice("ERROR:\nConnection to Retain failed.\nIs VPN active?", 10000)
                // console.log(err) // includes credentials
            } else {
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
                new Notice("Importing...");
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
            const projectPath = CT_PROJECTS_ROOT + "/Basic_Projects/" + projectID
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
                    await app.vault.delete(app.vault.getAbstractFileByPath(CT_PROJECTS_ROOT + "/People/Retain/" + r.RES_DESCR + ".md")!)
                } catch (e) {}
                const note = (await tp.templater.create_new_note_from_template(templateFile, CT_PROJECTS_ROOT + "/People/Retain", r.RES_DESCR, false))
        }
        new Notice(`Imported ${resources.length} people.`)
    }


    // dataviewjs functions ================

    revenue(dv: any, pages: PageMetadata[], group: string | null): void {
        let allProjectsData: any[] = [];
        let monthlyRevenueTotals: { [monthKey: string]: number } = {};
        let monthlyPDTotals: { [monthKey: string]: number } = {};
        let allMonths = new Set<string>();
        let totalBudgetPD = 0;

        for (const page of pages) {
            const start = page.Execution_Start;
            const end = page.Execution_End;
            const budget = page.Budget_PD;
            const rate = page.Avg_PD_Rate;

            const totalProjectRevenue = (budget ?? 0) * (rate ?? 0); // Use nullish coalescing for safety

            if (totalProjectRevenue <= 0)
                continue;
            
            totalBudgetPD += (budget ?? 0);

            let workingDaysInRange = 0;
            let currentDay = start;

            // Calculate working days within the project duration
            while (currentDay && end && currentDay <= end) {
                if (currentDay.weekday >= 1 && currentDay.weekday <= 5) {
                    workingDaysInRange++;
                }
                currentDay = currentDay.plus({ days: 1 });
            }

            // Skip if no working days found in the duration
            if (workingDaysInRange <= 0) {
                // Refund the budget that was added before the check
                totalBudgetPD -= (budget ?? 0);
                continue;
            }

            const dailyWorkingRevenue = totalProjectRevenue / workingDaysInRange;
            const dailyWorkingPD = (budget ?? 0) / workingDaysInRange;

            const projectMonthlyRevenueBreakdown: { [monthKey: string]: number } = {};
            currentDay = start; // Reset currentDay for the monthly breakdown calculation

            // Calculate monthly breakdown of revenue and PDs
            while (currentDay && end && currentDay <= end) {
                if (currentDay.weekday >= 1 && currentDay.weekday <= 5) {
                    const monthKey = currentDay.toFormat('yyyy-MM');

                    allMonths.add(monthKey);

                    projectMonthlyRevenueBreakdown[monthKey] = (projectMonthlyRevenueBreakdown[monthKey] || 0) + dailyWorkingRevenue;

                    monthlyRevenueTotals[monthKey] = (monthlyRevenueTotals[monthKey] || 0) + dailyWorkingRevenue;

                    monthlyPDTotals[monthKey] = (monthlyPDTotals[monthKey] || 0) + dailyWorkingPD;
                }
                currentDay = currentDay.plus({ days: 1 });
            }

            allProjectsData.push({
                name: page.file.link,
                monthlyBreakdown: projectMonthlyRevenueBreakdown,
                total: totalProjectRevenue,
                groupValue: group ? page[group] : null // Get the value for the specified group key
            });
        }

        const sortedMonths = Array.from(allMonths).sort();

        // Build table headers
        const headers: (string | any)[] = [(group ? group : "Project"), ...sortedMonths.map(monthKey => dv.date(monthKey).toFormat('MMM')), "Total"];

        // Build PD Totals row
        const pdTotalsRow: (string | number)[] = ["**PD Total**"];
        for (const monthKey of sortedMonths) {
            const monthPDTotal = monthlyPDTotals[monthKey] || 0;
            pdTotalsRow.push(`**${monthPDTotal.toFixed(2)}**`);
        }
        pdTotalsRow.push(`**${totalBudgetPD.toFixed(2)}**`);

        // Build Revenue Totals row and calculate grand total
        const revenueTotalsRow: (string | number)[] = ["**Revenue Total**"];
        let grandTotalRevenue = 0;
        for (const monthKey of sortedMonths) {
            const monthRevenueTotal = monthlyRevenueTotals[monthKey] || 0;
            revenueTotalsRow.push(`**${monthRevenueTotal.toFixed(2)}**`);
            grandTotalRevenue += monthRevenueTotal;
        }
        revenueTotalsRow.push(`**${grandTotalRevenue.toFixed(2)}**`);

        let itemRows: (string | any)[][] = [];

        if (group) {
            // Group data by the specified field
            const groupedData: { [key: string]: { monthlyBreakdown: { [monthKey: string]: number }, total: number } } = {};

            for (const project of allProjectsData) {
                let key = project.groupValue !== undefined && project.groupValue !== null && project.groupValue !== '' ? project.groupValue : 'Unspecified';
                if (key.toString().trim() === '') { // Handle empty strings for group key
                    key = 'Unspecified';
                }

                if (!groupedData[key]) {
                    groupedData[key] = {
                        monthlyBreakdown: {},
                        total: 0
                    };
                }

                for (const month in project.monthlyBreakdown) {
                    if (!groupedData[key].monthlyBreakdown[month]) {
                        groupedData[key].monthlyBreakdown[month] = 0;
                    }
                    groupedData[key].monthlyBreakdown[month] += project.monthlyBreakdown[month];
                }
                groupedData[key].total += project.total;
            }

            // Create table rows for grouped data
            itemRows = Object.keys(groupedData).sort((a, b) => String(a).localeCompare(String(b))).map(groupKey => {
                const row: (string | number | any)[] = [groupKey]; // groupKey might not be a string, e.g., Link
                const groupData = groupedData[groupKey];
                for (const monthKey of sortedMonths) {
                    const monthlyAmount = groupData.monthlyBreakdown[monthKey] || 0;
                    row.push(monthlyAmount.toFixed(2));
                }
                row.push(groupData.total.toFixed(2));
                return row;
            });

        } else {
            // Create table rows for individual projects
            itemRows = allProjectsData.map(project => {
                const row: (string | number | any)[] = [project.name]; // project.name is a Dataview Link
                for (const monthKey of sortedMonths) {
                    const monthlyAmount = project.monthlyBreakdown[monthKey] || 0;
                    row.push(monthlyAmount.toFixed(2));
                }
                row.push(project.total.toFixed(2));
                return row;
            });
        }

        const tableRows = [pdTotalsRow, revenueTotalsRow, ...itemRows];

        if (allProjectsData.length > 0) {
            // dv.table(headers, tableRows);
            const alignment: Align[] = [Align.Left, ...Array(sortedMonths.length + 1).fill(Align.Right)];
            const markdownTable = getMarkdownTable({
                table: {
                    head: headers,
                    body: tableRows.map(row => row.map(cell => String(cell).replace(/\|/g, "\\|"))),
                },
                alignment: alignment,
            });
            dv.paragraph(markdownTable);
        } else {
            dv.paragraph("No projects found with valid revenue or budget data in this folder with working days in their duration (after filtering).");
        }
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
            window.ct.createProject(projectID, importIt, parent)
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
        }, delay);
    });
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
