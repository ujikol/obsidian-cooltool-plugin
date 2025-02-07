// import { ChildProcess } from 'child_process';
import { Plugin } from 'obsidian'
import { CoolTool, CreateProjectCommand, ImportPeopleCommand } from 'src/cooltool'
import { configureDefaultSettingsCommand } from 'src/configure'
import { CoolToolSettings } from 'src/types'
import { CoolToolSettingTab } from 'src/settings'
// import { NoteAsHtmlToClipboardCommand, ExportNoteAsHtmlCommand } from 'src/render'


export default class CoolToolPlugin extends Plugin {
    settings: CoolToolSettings

	async onload() {
		window.ct = new CoolTool(this)
        await this.loadSettings()
		this.addCommand(configureDefaultSettingsCommand(this))
		this.addSettingTab(new CoolToolSettingTab(this.app, this));
		this.addCommand(CreateProjectCommand(this))
		this.addCommand(ImportPeopleCommand(this))
		// this.addCommand(NoteAsHtmlToClipboardCommand(this))
		// this.addCommand(ExportNoteAsHtmlCommand(this))
		this.addCommand(
			{
				id: 'toggle-dark-mode',
				name: 'Toggle dark mode',
				callback: () => {
					(this.app as any).changeTheme((this.app as any).getTheme() === 'obsidian' ? 'moonstone' : 'obsidian')
				},
			},
		)
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, {me: []}, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
