// import { ChildProcess } from 'child_process';
import { Plugin, TFile, EventRef, MarkdownView, Editor, Command } from 'obsidian'
import { CoolTool, CreateProjectCommand, ImportPeopleCommand, UpdateCommand, UpdatePropertiesCommand, updateProperties } from 'src/cooltool'
import { CoolToolSettings } from 'src/types'
import { CoolToolSettingTab } from 'src/settings'
// import { NoteAsHtmlToClipboardCommand, ExportNoteAsHtmlCommand } from 'src/render'


export default class CoolToolPlugin extends Plugin {
    settings: CoolToolSettings
    private isEnabled: boolean = true
    private eventRefs: EventRef[] = []
    private originalSaveCallback: (() => void) | null = null
    private lastActiveFile: TFile | null = null

	async onload() {
		window.ct = new CoolTool(this)
        this.isEnabled = true
        await this.loadSettings()
		this.addSettingTab(new CoolToolSettingTab(this.app, this))

		this.addCommand(CreateProjectCommand(this))
		this.addCommand(ImportPeopleCommand(this))
		this.addCommand(UpdateCommand(this))
		this.addCommand(UpdatePropertiesCommand(this))
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

        // register property update on multiple hooks
        this.lastActiveFile = this.app.workspace.getActiveFile()
        let eventRef = this.app.workspace.on('active-leaf-change', () => this.onActiveLeafChange())
        this.registerEvent(eventRef)
        this.eventRefs.push(eventRef)
        eventRef = this.app.workspace.on('quit', () => this.onChange())
        this.registerEvent(eventRef)
        this.eventRefs.push(eventRef)
        eventRef = this.app.workspace.on('quick-preview', () => this.onChange())
        this.registerEvent(eventRef)
        this.eventRefs.push(eventRef)

        // onSave hook
        // https://github.com/hipstersmoothie/obsidian-plugin-prettier/blob/main/src/main.ts
        const saveCommandDefinition = this.app.commands?.commands?.['editor:save-file']
        this.originalSaveCallback = saveCommandDefinition?.callback
        if (typeof this.originalSaveCallback === 'function') {
            saveCommandDefinition.callback = () => {
                this.originalSaveCallback!()
                if (this.isEnabled) {
                    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor as Editor
                    if (editor) {
                        const file = this.app.workspace.getActiveFile()
                        if (file?.extension === 'md' && editor.cm) {
                            updateProperties(file, 2000)
                        }
                    }
                }
            }
        }
        // defines the vim command for saving a file and lets the linter run on save for it
        // accounts for https://github.com/platers/obsidian-linter/issues/19
        const that = this
        window.CodeMirrorAdapter.commands.save = () => {that.app.commands.executeCommandById('editor:save-file')}
        console.log('CoolTool loaded')
    }

	onunload() {
        this.isEnabled = false
	    for (const eventRef of this.eventRefs) {
            this.app.workspace.offref(eventRef)
        }
        const saveCommandDefinition = this.app.commands?.commands?.['editor:save-file']
        if (saveCommandDefinition?.callback && this.originalSaveCallback) {
            saveCommandDefinition.callback = this.originalSaveCallback
        }      
        console.log('CoolTool unloaded')
    }

	async loadSettings() {
		this.settings = Object.assign({}, {me: []}, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

    async onActiveLeafChange() {
        if (!this.isEnabled)
            return
        const currentActiveFile = this.app.workspace.getActiveFile();
        const lastActiveFileExists = this.lastActiveFile == null ? false : await this.app.vault.adapter.exists(this.lastActiveFile.path)
        if (!lastActiveFileExists || this.lastActiveFile === currentActiveFile || this.lastActiveFile?.extension !== 'md') {
            this.lastActiveFile = currentActiveFile
            return
        }
        await updateProperties(this.lastActiveFile)
        this.lastActiveFile = currentActiveFile
    }

    async onQuit() {
        if (!this.isEnabled)
            return
        await updateProperties(this.app.workspace.getActiveFile()!)
    }

    async onChange() {
        if (!this.isEnabled)
            return
        await updateProperties(this.app.workspace.getActiveFile()!, 7000)
    }
}
