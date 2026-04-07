import type { App } from "obsidian"
import type { DataviewApi } from "obsidian-dataview"

declare global {
	interface Window {
		DataviewAPI?: DataviewApi
	}
}

/** Same resolution as Dataview’s published `getAPI`: loaded plugin, then `window.DataviewAPI`. */
export function getDataviewApi(app: App): DataviewApi | undefined {
	const fromPlugin = app.plugins.plugins.dataview?.api
	if (fromPlugin) return fromPlugin
	return window.DataviewAPI
}
