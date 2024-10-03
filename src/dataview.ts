export class TableRow extends Object {
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
