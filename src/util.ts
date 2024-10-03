import { Modal } from 'obsidian'


export class WaitModal extends Modal {
	// constructor(app: App) {
	// 	super(app);
	// }
	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Don't change anything until done!");
	}
	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

export async function replaceAsync(str:string , regex: RegExp, asyncFn: (substring: string, ...args: any[]) => Promise<string>) {
    const promises: Promise<string>[] = [];
    str.replace(regex, (full, ...args) => {
        promises.push(asyncFn(full, ...args));
        return full;
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift()!);
}

// function delay(ms: number) {
//     return new Promise( resolve => setTimeout(resolve, ms) );
// }
