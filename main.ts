// import { ChildProcess } from 'child_process';
import { Plugin } from 'obsidian'
import { CoolTool } from 'src/cooltool'
import { configureDefaultSettingsCommand } from 'src/configure'

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
		this.addCommand(configureDefaultSettingsCommand(this))
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

	// async loadSettings() {
	// 	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	// }

	// async saveSettings() {
	// 	await this.saveData(this.settings);
	// }
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
