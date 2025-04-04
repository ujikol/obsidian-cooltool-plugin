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

export function convertHtmlToRtf(html:string) {
    if (!(typeof html === "string" && html)) {
        return null;
    }

    var tmpRichText, hasHyperlinks;
    var richText = html;

    // Delete HTML comments
    richText = richText.replace(/<!--[\s\S]*?-->/ig,"");

    // Singleton tags
    richText = richText.replace(/<(?:hr)(?:\s+[^>]*)?\s*[\/]?>/ig, "{\\pard \\brdrb \\brdrs \\brdrw10 \\brsp20 \\par}\n{\\pard\\par}\n");
    richText = richText.replace(/<(?:br)(?:\s+[^>]*)?\s*[\/]?>/ig, "{\\pard\\par}\n");

    // Empty tags
    richText = richText.replace(/<(?:p|div|section|article)(?:\s+[^>]*)?\s*[\/]>/ig, "{\\pard\\par}\n");
    richText = richText.replace(/<(?:[^>]+)\/>/g, "");

    // Hyperlinks
    richText = richText.replace(
        /<a(?:\s+[^>]*)?(?:\s+href=(["'])(?:javascript:void\(0?\);?|#|return false;?|void\(0?\);?|)\1)(?:\s+[^>]*)?>/ig,
        "{{{\n");
    tmpRichText = richText;
    richText = richText.replace(
        /<a(?:\s+[^>]*)?(?:\s+href=(["'])(.+)\1)(?:\s+[^>]*)?>/ig,
        "{\\field{\\*\\fldinst{HYPERLINK\n \"$2\"\n}}{\\fldrslt{\\ul\\cf1\n");
    hasHyperlinks = richText !== tmpRichText;
    richText = richText.replace(/<a(?:\s+[^>]*)?>/ig, "{{{\n");
    richText = richText.replace(/<\/a(?:\s+[^>]*)?>/ig, "\n}}}");

    // Start tags
    richText = richText.replace(/<(?:b|strong)(?:\s+[^>]*)?>/ig, "{\\b\n");
    richText = richText.replace(/<(?:i|em)(?:\s+[^>]*)?>/ig, "{\\i\n");
    richText = richText.replace(/<(?:u|ins)(?:\s+[^>]*)?>/ig, "{\\ul\n");
    richText = richText.replace(/<(?:strike|del)(?:\s+[^>]*)?>/ig, "{\\strike\n");
    richText = richText.replace(/<sup(?:\s+[^>]*)?>/ig, "{\\super\n");
    richText = richText.replace(/<sub(?:\s+[^>]*)?>/ig, "{\\sub\n");
    richText = richText.replace(/<(?:p|div|section|article)(?:\s+[^>]*)?>/ig, "{\\pard\n");
    richText = richText.replace(/<(?:h1|h2|h3|h4|h5|h6)(?:\s+[^>]*)?>/ig, "{\\pard\\par}{\\pard\\b\n");
    richText = richText.replace(/<(?:ol)(?:\s+[^>]*)?>/ig,
        "{\\pard\\par}{{\\*\\pn\\pnlvlbody\\pnindent0\\pnstart1\\pndec{\\pntxta.}}\\fi-240\\li720\\sa200\\sl180\\slmult1");
    richText = richText.replace(/<(?:ul)(?:\s+[^>]*)?>/ig,
        "{\\pard\\par}{{\\*\\pn\\pnlvlblt\\pnf1\\pnindent0{\\pntxtb\\\'B7}}\\fi-240\\li720\\sa200\\sl180\\slmult1");
    richText = richText.replace(/<(?:li)(?:\s+[^>]*)?>/ig, "{\\pntext\\tab}");

    // End tags
    richText = richText.replace(/<\/(?:p|div|section|article)(?:\s+[^>]*)?>/ig, "\n\\par}\n");
    richText = richText.replace(/<\/(?:h1|h2|h3|h4|h5|h6)(?:\s+[^>]*)?>/ig, "\n\\par}\n");
    richText = richText.replace(/<\/(?:b|strong|i|em|u|ins|strike|del|sup|sub|ol|ul)(?:\s+[^>]*)?>/ig, "\n}");
    richText = richText.replace(/<\/(?:li)(?:\s+[^>]*)?>/ig, "\\par");

    // Strip any other remaining HTML tags [but leave their contents]
    richText = richText.replace(/<(?:[^>]+)>/g, "");

    // Remove empty line at the beginning of the text
    richText = richText.startsWith("{\\pard\\par}")  ? richText.substring(11) : richText;

    // Prefix and suffix the rich text with the necessary syntax
    richText =
        "{\\rtf1\\ansi\n" + (hasHyperlinks ? "{\\colortbl\n;\n\\red0\\green0\\blue255;\n}\n" : "") + richText + "\n}";

    return richText;
}
