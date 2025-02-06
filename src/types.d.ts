import { Plugin, TFile, TFolder } from 'obsidian'
import { DataviewApi } from "obsidian-dataview"

interface CoolToolPlugin extends Plugin {
    settings: CoolToolSettings
    loadSettings(): Promise<void>
    saveSettings(): Promise<void>
}

interface CoolToolInterface {
    plugin: Plugin
	dv: DataviewApi
	createProject: (projectID:string, importIt: boolean, parent: boolean) => any
    importPeople: () => any
}

type CoolToolSettings = {
    me: string[]
}

interface TemplaterPlugin {
    templater: {
        create_new_note_from_template: (template: TFile | string, folder?: TFolder | string, filename?: string, open_new_note?: boolean) => Promise<TFile | undefined>
        parse_template: (config: any, template_content: string) => Promise<string>
        create_running_config: (template_file: TFile | undefined, target_file: TFile, run_mode: any) => any
    }
}

interface WebpageExportPlugin {
    api: {
        renderMarkdownToString: (markdown: string, options?: MarkdownRendererAPIOptions) => Promise<string | undefined>
    }
}

declare global {
    interface Window {
        ct: CoolToolInterface
    }
}

type MarkdownRendererAPIOptions = {
	// The container to render the HTML into.
	container?: HTMLElement
	// Keep the .markdown-preview-view or .view-content container elements.
	keepViewContainer?: boolean
	// Convert the headers into a tree structure with all children of a header being in their own container.
	makeHeadersTrees?: boolean
	// Run post processing on the html to clean up various obsidian specific elements.
	postProcess?: boolean
	// Display a window with a log and progress bar.
	displayProgress?: boolean
}

// MsTeams
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
