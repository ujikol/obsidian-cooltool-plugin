import { App, Setting, PluginSettingTab } from 'obsidian';
import { CoolToolPlugin } from './types.d';

export class CoolToolSettingTab extends PluginSettingTab {
    plugin: CoolToolPlugin;

    constructor(app: App, plugin: CoolToolPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Your Match Code')
			.setDesc('What identifies tasks as your tasks based on the actor. (@)')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.me.join("; "))
				.onChange(async (value) => {
					this.plugin.settings.me = value.split(";").map(w=>w.trim())
					await this.plugin.saveSettings();
				}));
	}
}
