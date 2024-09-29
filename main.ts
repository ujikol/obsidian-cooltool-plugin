// import { ChildProcess } from 'child_process';
import { App, Editor, Notice, Plugin, CachedMetadata, HeadingCache, SectionCache, Modal } from 'obsidian';
import { getAPI, DataviewApi } from "obsidian-dataview"
import { DataArray } from 'obsidian-dataview/lib/api/data-array'
import { delay } from 'es-toolkit'

// const tmp = require('tmp')
// import { DataviewInlineApi } from 'obsidian-dataview/lib/api/inline-api'

// interface MyPluginSettings {
// 	mySetting: string;
// }

// const DEFAULT_SETTINGS: MyPluginSettings = {
// 	mySetting: 'default'
// }

export default class CoolToolPlugin extends Plugin {

	async onload() {
		// await this.loadSettings();
		window.ct = new CoolTool(this)
	}

	onunload() {

	}

	// async loadSettings() {
	// 	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	// }

	// async saveSettings() {
	// 	await this.saveData(this.settings);
	// }
}

class TableRow extends Object {
	[key: string]: any
	// get length():number {
	// 	return Object.keys(this).length
	// }
	hasRole(roles:string[]): boolean {
		return this["Role"].split(",").map((r: string)=>r.trim())
			.filter((r: string) => roles.includes(r))
			.length > 0
	}
	// map(f:Function): any {
	// 	const r = Object.keys(this).map(k => f(this[k]))
	// 	return r
	// }
}

type MsTeamsTeam = {
	id: string | null,
	displayName: string,
	description: string,
	options: MsTeamsOptions, 
	owners: string[], 
	members: string[], 
	channels: MsTeamsChannel[]
}
type MsTeamsOptions = { [key: string]: string | boolean }
type MsTeamsChannel = { displayName: string, description: string, membershipType: string, options: MsTeamsOptions, owners: string[], members: string[] }
const MsTeamsUpdateSuccessMessage = "DONE with creating/updating team:"

class CoolTool {
	plugin: CoolToolPlugin
	dv: DataviewApi

	constructor(plugin: CoolToolPlugin) {
			this.plugin = plugin
			this.getDataview()
		}

	test() {
		console.log("CT is here.", this.plugin.app.plugins.plugins["dataview"]!.api)
	}

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

	// Needs:
	// Install-Module -Name PowerShellGet -Scope CurrentUser -Force -AllowClobber
	// Install-Module -Name MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
	// Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
	async executePowerShellCommand(cmd: string): Promise<[boolean, string]> {
		const powershellPath = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
		const execute = (args: string): Promise<[boolean, string]> => {
			return new Promise((resolve, reject) => {
				require('child_process').exec(`powershell ${args}`, { shell: true, detached: true }, (error: any, stdout: string, stderr: string) => {
					if (error) {
						reject(`Error: ${error.message}`);
						return [false, error.message];
					}
					if (stderr) {
						resolve([false, stderr.trim() + "\n" + stdout.trim()]);
					}
					resolve([true, stdout.trim()]);
				});
			});
		}
		const tmpFile = require('tmp').tmpNameSync({postfix: '.ps1'})
		require('fs').writeFileSync(tmpFile, cmd)
		let [success, output] = await execute('-file ' + tmpFile)
		require('fs').unlinkSync(tmpFile)
		// try {
		// 	output = require('child_process').execSync(`powershell -file ${tmpFile}`, { shell: true, detached: true }).toString()
		// 	require('fs').unlinkSync(tmpFile)
		// } catch (err){ 
		// 	console.log("XXX2", err.stdout.toString())
		// 	console.log("XXX3", err.stderr.toString())
		// 	// throw err
		// }
		return [success, output]
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

	team(heading: string = "Team"): DataArray<string> {
		return new ParsingBuffer(this.plugin, this.dv).getStakeholders(heading)
	}
	
	async msteamsSetupTeam(team: MsTeamsTeam): Promise<[boolean, string|null, string|null]> {
		const members = [...new Set([...team.members, ...team.owners])];
		const code = [
			'Import-Module MicrosoftTeams',
			// '[console]::beep(500,300)',
			'Connect-MicrosoftTeams',
			team.id ? `$group = Get-Team -GroupID ${team.id}` : `$group = New-Team -DisplayName "${team.displayName}"`,
			'$id = $group.GroupId',
			'"TeamID: $id"',
			this.updateOptions(team.options, null),
			this.updateUsers(members, 'Member', null),
			this.updateUsers(team.owners, 'Owner', null),
			this.updateChannels(team.channels),
			`"${MsTeamsUpdateSuccessMessage}"`,
			'"$id"',
			// 'exit 1'
		].filter(Boolean).join('\n');
		let [success, output] = (await this.executePowerShellCommand(code))!
		// if (!output)
		// 	return [false, null, null]
		const match = output.match(/TeamID: ([0-9a-f\-]+)/i)
		const id = match ? match[1] : null
		success = success && output.contains(MsTeamsUpdateSuccessMessage)
		if (!success) {
			console.log("MsTeams Error:\n" + output)
			console.log("Failed Code:\n", code)
		}
		return [success, id, output]
}

	updateOptions(options: MsTeamsOptions, channel: string | null): string {
		if (Object.entries(options).length === 0)
			return ""
		const cmdsup = channel ? "Channel" : "";
		const idsup = channel ? ` -CurrentDisplayName ${this.pssavpar(channel)}` : "";
		return `Set-Team${cmdsup} -GroupId $id${idsup} ${Object.entries(options)
			.map(([k,v]) => `-${k} ${(typeof v === 'string' ? this.pssavpar(v) : (v ? "$true" : "$false"))}`).join(" ")}`;
	}
		
	updateUsers(users: string[], role: string | null, channel: string | null): string {
		const roleCmd = role === "Owner" ? ` -Role '${role}'` : "";
		const cmdsup = channel ? "Channel" : "";
		const idsup = channel ? ` -DisplayName ${this.pssavpar(channel)}` : "";
		const usersCmd = users.map(user => `$news.Add('${user}')`).join('\n');
		return `"--- Update ${cmdsup} users (${role}) for ${channel} ---"
$olds = (Get-Team${cmdsup}User -GroupID $id${idsup} ${roleCmd}).User
$news = [System.Collections.ArrayList]@()
${usersCmd}
foreach ($it in $news) { if ($olds -notcontains $it) { Add-Team${cmdsup}User -GroupID $id${idsup} -User $it${roleCmd} } }
foreach ($it in $olds) { if ($news -notcontains $it) { Remove-Team${cmdsup}User -GroupID $id${idsup} -User $it${roleCmd} } }`;
	}
	
	updateChannels(channels: MsTeamsChannel[]): string {
		if (!channels || channels.length === 0) return '';
		const data = channels.map((ch: MsTeamsChannel) => {
			ch.members = [...new Set([...ch.members, ...ch.owners])];
			// : MsTeamsOptions = Object.assign({}, ...
				// Object.entries(ch.options).filter(([k,v]) => k.toUpperCase() !== 'MembershipType').map(([k,v]) => ({[k]:v})))
			// console.log("XXXn", ch.displayName, ch.membershipType, ch.options, ch.members, ch.owners)
			return [
				`$news.Add(${this.pssavpar(ch.displayName)})`,
				`$types.Add(${this.pssavpar(ch.displayName)}, '${ch.membershipType}')`,
				`$descriptions.Add(${this.pssavpar(ch.displayName)}, ${this.pssavpar(ch.description)})`,
				this.updateOptions(ch.options, ch.displayName),
				ch.membershipType !== 'Standard' ? this.updateUsers(ch.members, 'Member', ch.displayName) : '',
				ch.membershipType !== 'Standard' ? this.updateUsers(ch.owners, 'Owner', ch.displayName) : ''
			] //.filter(Boolean).join('\n');
		});
		return `"--- Update channels ---"
$olds = (Get-TeamChannel -GroupID $Id).DisplayName
$news = [System.Collections.ArrayList]@()
${data.map(d => d[0]).join('\n')}
$types = @{}
${data.map(d => d[1]).join('\n')}
$descriptions = @{}
${data.map(d => d[2]).join('\n')}
foreach ($it in $news) { if ($olds -notcontains $it) { New-TeamChannel -GroupID $id -DisplayName $it -MembershipType $types[$it] -Description $descriptions[$it] ; } }
${data.map(d => d[3]).join('\n')}
${data.map(d => d[4]).join('\n')}
${data.map(d => d[5]).join('\n')}`
	}

	pssavpar(value: string): string {
		return `"${value.replace(/"/g, '""')}"`; // Escape double quotes
	}
	  
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
			const [success, id, output] = await this.msteamsSetupTeam(team)
			if (id && idInsertLine)
				this.plugin.app.workspace.activeEditor!.editor!.replaceRange(`:ID: ${id}\n`, {line:idInsertLine!, ch:0})
			if (success)
				new Notice("Creation/Update succeeded.")
			else
				new Notice("Creation/Update failed:\n" + output)
			waitModal.close()
		}
	}
}

class ParsingBuffer {
	plugin: CoolToolPlugin
	app: App
	editor: Editor
	cache: CachedMetadata
	headings: HeadingCache[]
	sections: SectionCache[]
	text: string
	dv: DataviewApi

	constructor(plugin: CoolToolPlugin, dv:DataviewApi) {
		this.plugin = plugin
		this.app = plugin.app
		const activeEditor = this.app.workspace.activeEditor!
		this.editor = activeEditor.editor!
		this.cache = this.app.metadataCache.getFileCache(activeEditor.file!)!
		this.text = this.editor.getValue()
		this.sections = this.cache.sections!
		this.headings = this.cache.headings!
		// @ts-ignore
		this.htmlElements = Array.from(this.editor.cm.contentDOM.children)
		// this.htmlText = WebpageHTMLExport.api.renderFileToString(currentFile, {})
		this.dv = dv
	}

	getStakeholders(heading: string = "Team"): DataArray<string> {
        const headings = this.cache.headings!
        const table_heading = headings.find((h: HeadingCache) => h.heading === heading)
        if (!table_heading)
            throw "No Teams heading."
        let i = -1
        while (++i < this.sections.length) {
            if (this.sections[i].type === "heading" && this.sections[i].position.start.offset === table_heading.position.start.offset) {
                if (++i < this.sections.length && this.sections[i].type === "table") {
                    const table = this.dv.array(this.parseTable(this.text.slice(this.sections[i].position.start.offset)))
                    // table.forEach((r:TableRow) => r.hasRole = (roles) =>
                    //     r["Role"].split(",").map((r: string)=>r.trim())
                    //         .filter((r: string) => roles.includes(r))
                    //         .length > 0)
                    return table
                }
            }
        }
        throw "No table in Teams heading."
    }

    parseTable(markdown: string): TableRow[] {
        let rows = markdown.trim().split('\n');
        rows = rows.slice(0, rows.findIndex(r => !r.startsWith("| ")));
        const headers = rows[0].split('|').map(header => header.trim()).filter(Boolean);
        const dataRows = rows.slice(2);
        const parsedRows = dataRows.map(row => {
            const cells = (" " + row + " ").split(' | ')
                .map(cell => cell.trim())
                .filter(Boolean);
            const rowObject: TableRow = new TableRow();
            headers.forEach((header, index) => {
                rowObject[header] = cells[index];
            });
            return rowObject;
        });
        return parsedRows;
    }

	async parseMsTeam(teamName?: string): Promise<[MsTeamsTeam, number|null] | undefined> {
		try {
			let index: number
			if (teamName) {
				index = this.headings.findIndex(async (h: HeadingCache) => await this.expandedText(h.heading) === teamName)
				if (index < 0)
					throw `Error: Cannot find team heading ${teamName}.`
			} else {
				// Hope on "fix" of meta-bind plugin to provide notePosition for runInlineJsAction
				let cursor = this.editor.getCursor()
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
				//  = options["MembershipType"] as string
				// delete options["MembershipType"]
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
			// console.log("XXX1", team)
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
		const text = this.text.slice(this.editor.posToOffset({line: heading.position.start.line + 1, ch:0}),
				index < this.headings.length ? this.editor.posToOffset({line: this.headings[index + 1].position.start.line, ch:0}) : this.text.length)
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
			await this.dv.executeJs(code, container, this.plugin, this.app.workspace.activeEditor!.file?.path)
			await delay(1001)
			const result = container.innerHTML
			return result
		})
		text = text.replace(inlineRegex, (match, code): string => {
			const document = new Document()
			const container: HTMLElement = document.createElement("span")
			container.onNodeInserted = (listener: () => any,  once?: boolean | undefined) => () => {}
			let result = function () {
				return eval("const dataview = this.dv;const dv=this.dv;" + code)
			}.call({index:this.dv.index, component:this.plugin, container:container, app:this.app, settings:this.dv.settings, currentFilePath:this.app.workspace.activeEditor!.file!.path})
			return result
		})
		return text
	}
}

export class WaitModal extends Modal {
	// constructor(app: App) {
	// 	super(app);
	// }
	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Don't change anything until done!");
	}
	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

// function delay(ms: number) {
//     return new Promise( resolve => setTimeout(resolve, ms) );
// }

async function replaceAsync(str:string , regex: RegExp, asyncFn: (substring: string, ...args: any[]) => Promise<string>) {
    const promises: Promise<string>[] = [];
    str.replace(regex, (full, ...args) => {
        promises.push(asyncFn(full, ...args));
        return full;
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift()!);
}

// class SampleSettingTab extends PluginSettingTab {
// 	plugin: MyPlugin;

// 	constructor(app: App, plugin: MyPlugin) {
// 		super(app, plugin);
// 		this.plugin = plugin;
// 	}

// 	display(): void {
// 		const {containerEl} = this;

// 		containerEl.empty();

// 		new Setting(containerEl)
// 			.setName('Setting #1')
// 			.setDesc('It\'s a secret')
// 			.addText(text => text
// 				.setPlaceholder('Enter your secret')
// 				.setValue(this.plugin.settings.mySetting)
// 				.onChange(async (value) => {
// 					this.plugin.settings.mySetting = value;
// 					await this.plugin.saveSettings();
// 				}));
// 	}
// }
