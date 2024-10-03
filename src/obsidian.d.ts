// import * as obsidian from 'obsidian'
import { DataviewApi } from 'obsidian-dataview'
// import { DataArray } from 'obsidian-dataview/lib/api/data-array'
// import * as internal from 'stream'


declare module 'obsidian' {
    interface App {
        plugins: {
            enabledPlugins: Set<string>
            plugins: {
                [id: string]: unknown
                dataview?: {
                    api?: DataviewApi
                    manifest: {
                        version: string
                    }
                }
            }
        }
        internalPlugins: {
            // config: any
            plugins: {
                graph: {
                    enabled: boolean
                    loadSettings: () => void
                }
            }
        }
        setting: {
            openTabById: (tabId: 'hotkeys') => {
                searchComponent: SearchComponent
                updateHotkeyVisibility: () => void
            }
        }
        commands: {
            commands: {
                [id:string]: {
                    callback: () => void
                }
            }
            removeCommand: (commandName: string) => void
        }
    }
    interface MetadataCache {
        on(
            name: 'dataview:api-ready',
            callback: (api: DataviewApi) => unknown,
            ctx?: unknown,
        ): EventRef;
        on(
            name: 'dataview:metadata-change',
            callback: (
                ...args:
                | [op: 'rename', file: TAbstractFile, oldPath: string]
                | [op: 'delete', file: TFile]
                | [op: 'update', file: TFile]
            ) => unknown,
            ctx?: unknown,
        ): EventRef;
    }
    interface DataAdapter {
        basePath: string
    }
}


// declare module 'obsidian-dataview' {
//     export interface DataviewApi {
//         executeJs: (code: string, container: any, component: any, filePath: any) => Promise<undefined>
//         array(raw: unknown): DataArray<any>
//         span: any
//     }
// }

// declare module 'obsidian-dataview/lib/api/inline-api' {
//     interface DataviewInlineApi {
//         constructor: (index: any, component: any, container: HTMLElement, app: any, settings: any, verNum: string, currentFilePath: string) => any
//     }
// }
