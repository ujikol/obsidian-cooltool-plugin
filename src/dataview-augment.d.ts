import type { App } from "obsidian"

/**
 * The npm `obsidian-dataview` package only publishes a stub `index.d.ts`; runtime APIs
 * (`getAPI`, `DataArray`, `PageMetadata`) exist at runtime via the Dataview plugin.
 * This augmentation restores the symbols the app imports for `tsc`.
 */
declare module "obsidian-dataview" {
	export function getAPI(app: App): DataviewApi | undefined

	/** Callbacks use `any` for elements so call sites match Dataview’s loose row typing (e.g. `DataArray<string>` with `TableRow` filters). */
	export interface DataArray<T> {
		length: number
		where(predicate: (elem: any, index: number, arr: any[]) => boolean): DataArray<T>
		filter(predicate: (elem: any, index: number, arr: any[]) => boolean): DataArray<T>
		map<U>(f: (elem: any, index: number, arr: any[]) => U): DataArray<U>
		flatMap<U>(f: (elem: any, index: number, arr: any[]) => U[]): DataArray<U>
		mutate(f: (elem: any, index: number, arr: any[]) => any): DataArray<any>
		limit(count: number): DataArray<T>
		slice(start?: number, end?: number): DataArray<T>
		concat(other: Iterable<T>): DataArray<T>
		indexOf(element: T, fromIndex?: number): number
		find(pred: (elem: any, index: number, arr: any[]) => boolean): T | undefined
		findIndex(pred: (elem: any, index: number, arr: any[]) => boolean, fromIndex?: number): number
		includes(element: T): boolean
		join(sep?: string): string
		sort<U>(
			key: (elem: any, index: number, arr: any[]) => U,
			direction?: "asc" | "desc",
			comparator?: (a: U, b: U) => number,
		): DataArray<T>
		groupBy<U>(
			key: (elem: any, index: number, arr: any[]) => U,
			comparator?: (a: U, b: U) => number,
		): DataArray<{ key: U; rows: DataArray<T> }>
		distinct<U>(
			key?: (elem: any, index: number, arr: any[]) => U,
			comparator?: (a: U, b: U) => number,
		): DataArray<T>
		every(f: (elem: any, index: number, arr: any[]) => boolean): boolean
		some(f: (elem: any, index: number, arr: any[]) => boolean): boolean
		none(f: (elem: any, index: number, arr: any[]) => boolean): boolean
		first(): T
		last(): T
		to(key: string): DataArray<any>
		into(key: string): DataArray<any>
		expand(key: string): DataArray<any>
		forEach(f: (elem: any, index: number, arr: any[]) => void): void
		array(): T[]
		[Symbol.iterator](): Iterator<T>
		[index: number]: any
		[field: string]: any
	}

	export interface PageMetadata {
		path: string
		[key: string]: any
	}
}
