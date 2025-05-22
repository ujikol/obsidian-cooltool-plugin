// Needs:
// Install-Module -Name PowerShellGet -Scope CurrentUser -Force -AllowClobber
// Install-Module -Name MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
// Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser


// const { btoa } = require("node:buffer")


export async function curlRequest (args: string, debug = false): Promise<[boolean, string]> {
    return new Promise((resolve, reject) => {
        const cmd = "curl " + (debug ? "-i -v " : "-s ") + '-A "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:77.0) Gecko/20100101 Firefox/77.0" ' + args
        if (debug)
            console.log("COMMAND:", cmd)
        require("child_process").exec(cmd, { shell: true, detached: true, maxBuffer: 100*1024*1024}, (error: any, stdout: string, stderr: string) => {
            if (error) {
                reject(`Error: ${error.message}`);
                return [false, error.message];
            }
            if (stderr) {
                resolve([false, stderr.trim() + "\n" + stdout.trim()]);
            }
            resolve([true, stdout.trim()]);
        });
    });
}

export async function curlGetRequest(url: string, params?: string[], ntlmCredentials?:string, debug = false): Promise<string> {
    const response = (await curlRequest(
        (ntlmCredentials ? ("--ntlm -u " + ntlmCredentials) + " " : "") +
        `"` + url + '"' +
        (params ? "?" + params?.map(p=>encodeURI(p)).join("&") : ""),
        debug
    ))
    if (debug)
        console.log("SUCCESS & RESPONSE:", response)
    return response[1]
}
