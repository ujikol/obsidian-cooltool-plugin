// Needs:
// Install-Module -Name PowerShellGet -Scope CurrentUser -Force -AllowClobber
// Install-Module -Name MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
// Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
export async function executePowerShellCommand(cmd: string): Promise<[boolean, string]> {
    const powershellPath = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    const execute = (args: string): Promise<[boolean, string]> => {
        return new Promise((resolve, reject) => {
            require('child_process').exec(`powershell ${args}`, { shell: true, detached: true }, (error: any, stdout: string, stderr: string) => {
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
    const tmpFile = require('tmp').tmpNameSync({postfix: '.ps1'})
    require('fs').writeFileSync(tmpFile, cmd)
    let [success, output] = await execute('-file ' + tmpFile)
    // console.log("XXX0 " + tmpFile)
    require('fs').unlinkSync(tmpFile)
    return [success, output]
}

export function pssavpar(value: string): string {
    const utf8Bytes = new TextEncoder().encode(value)
    const base64 = btoa(String.fromCharCode(...utf8Bytes))
    return `([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}')))`
}
