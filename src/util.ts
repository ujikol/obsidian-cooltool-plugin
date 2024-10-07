import { Modal, getLinkpath, normalizePath, Vault } from 'obsidian'


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

export function pathFromLink(link: string, vault: Vault): string {
    // const match = link.match(/^\s*\[\[(.+)(\|.*)?\]\]\s*$/)
    // if (match)
    //     return getLinkpath(match[1])
    console.log("XXX5", link)
    link = getLinkpath(link)
    console.log("XXX6", link)
    link = normalizePath(link)
    console.log("XXX7", link)
    link = vault.adapter.getResourcePath(link)
    console.log("XXX8", link)
    return link
}

// function delay(ms: number) {
//     return new Promise( resolve => setTimeout(resolve, ms) );
// }
