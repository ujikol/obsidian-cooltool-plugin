import { MarkdownFileInfo, Plugin, TFile, TFolder } from 'obsidian'
import { DataviewApi } from "obsidian-dataview"

interface CoolToolPlugin extends Plugin {}

interface CoolToolInterface {
//   obsidian?: typeof obsidian;
//   app?: obsidian.App;
    plugin: Plugin
	dv: DataviewApi
	// buffer: MarkdownFileInfo|undefined|null
}

declare global {
    interface Window {
        ct: CoolToolInterface;
    }
    interface TemplaterPlugin {
        templater: {
            create_new_note_from_template: (template: TFile | string, folder?: TFolder | string, filename?: string, open_new_note?: boolean) => Promise<TFile | undefined>
			parse_template: (config: any, template_content: string) => Promise<string>
			create_running_config: (template_file: TFile | undefined, target_file: TFile, run_mode: any) => any
        }
    }
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
