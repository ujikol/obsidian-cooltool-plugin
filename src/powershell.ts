// Needs:
// Install-Module -Name PowerShellGet -Scope CurrentUser -Force -AllowClobber
// Install-Module -Name MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
// Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
async function executePowerShellCommand(cmd: string): Promise<[boolean, string]> {
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
    require('fs').unlinkSync(tmpFile)
    // try {
    // 	output = require('child_process').execSync(`powershell -file ${tmpFile}`, { shell: true, detached: true }).toString()
    // 	require('fs').unlinkSync(tmpFile)
    // } catch (err){ 
    // 	console.log("XXX2", err.stdout.toString())
    // 	console.log("XXX3", err.stderr.toString())
    // 	// throw err
    // }
    return [success, output]
}
