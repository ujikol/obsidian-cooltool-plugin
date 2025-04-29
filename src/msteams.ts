import { MsTeamsTeam, MsTeamsOptions, MsTeamsChannel } from "../src/types"
import { executePowerShellCommand, pssavpar} from "../src/powershell"


const MsTeamsUpdateSuccessMessage = "DONE with creating/updating team:"

export async function msteamsSetupTeam(team: MsTeamsTeam): Promise<[boolean, string|null, string|null]> {
    const members = [...new Set([...team.members, ...team.owners])];
    const code = [
        'Import-Module MicrosoftTeams',
        // '[console]::beep(500,300)',
        'Connect-MicrosoftTeams',
        team.id ? `$group = Get-Team -GroupID ${team.id}` : `$group = New-Team -DisplayName "${team.displayName}"`,
        '$id = $group.GroupId',
        '"TeamID: $id"',
        this.updateOptions(team.options, null),
        this.updateUsers(members, 'Member', null),
        this.updateUsers(team.owners, 'Owner', null),
        this.updateChannels(team.channels),
        `"${MsTeamsUpdateSuccessMessage}"`,
        '"$id"',
        // 'exit 1'
    ].filter(Boolean).join('\n');
    let [success, output] = (await executePowerShellCommand(code))!
    // if (!output)
    // 	return [false, null, null]
    const match = output.match(/TeamID: ([0-9a-f\-]+)/i)
    const id = match ? match[1] : null
    success = success && output.contains(MsTeamsUpdateSuccessMessage)
    if (!success) {
        console.error("MsTeams Error:\n" + output + "\nFailed Code:\n", code)
    }
    return [success, id, output]
}

function updateOptions(options: MsTeamsOptions, channel: string | null): string {
    if (Object.entries(options).length === 0)
        return ""
    const cmdsup = channel ? "Channel" : "";
    const idsup = channel ? ` -CurrentDisplayName ${pssavpar(channel)}` : "";
    return `Set-Team${cmdsup} -GroupId $id${idsup} ${Object.entries(options)
        .map(([k,v]) => `-${k} ${(typeof v === 'string' ? pssavpar(v) : (v ? "$true" : "$false"))}`).join(" ")}`;
}
    
function updateUsers(users: string[], role: string | null, channel: string | null): string {
    const roleCmd = role === "Owner" ? ` -Role '${role}'` : "";
    const cmdsup = channel ? "Channel" : "";
    const idsup = channel ? ` -DisplayName ${pssavpar(channel)}` : "";
    const usersCmd = users.map(user => `$news.Add('${user}')`).join('\n');
    return `"--- Update ${cmdsup} users (${role}) for ${channel} ---"
$olds = (Get-Team${cmdsup}User -GroupID $id${idsup} ${roleCmd}).User
$news = [System.Collections.ArrayList]@()
${usersCmd}
foreach ($it in $news) { if ($olds -notcontains $it) { Add-Team${cmdsup}User -GroupID $id${idsup} -User $it${roleCmd} } }
foreach ($it in $olds) { if ($news -notcontains $it) { Remove-Team${cmdsup}User -GroupID $id${idsup} -User $it${roleCmd} } }`;
}

function updateChannels(channels: MsTeamsChannel[]): string {
    if (!channels || channels.length === 0) return '';
    const data = channels.map((ch: MsTeamsChannel) => {
        ch.members = [...new Set([...ch.members, ...ch.owners])];
        return [
            `$news.Add(${pssavpar(ch.displayName)})`,
            `$types.Add(${pssavpar(ch.displayName)}, '${ch.membershipType}')`,
            `$descriptions.Add(${pssavpar(ch.displayName)}, ${pssavpar(ch.description)})`,
            this.updateOptions(ch.options, ch.displayName),
            ch.membershipType !== 'Standard' ? this.updateUsers(ch.members, 'Member', ch.displayName) : '',
            ch.membershipType !== 'Standard' ? this.updateUsers(ch.owners, 'Owner', ch.displayName) : ''
        ]
    });
    return `"--- Update channels ---"
$olds = (Get-TeamChannel -GroupID $Id).DisplayName
$news = [System.Collections.ArrayList]@()
${data.map(d => d[0]).join('\n')}
$types = @{}
${data.map(d => d[1]).join('\n')}
$descriptions = @{}
${data.map(d => d[2]).join('\n')}
foreach ($it in $news) { if ($olds -notcontains $it) { New-TeamChannel -GroupID $id -DisplayName $it -MembershipType $types[$it] -Description $descriptions[$it] ; } }
${data.map(d => d[3]).join('\n')}
${data.map(d => d[4]).join('\n')}
${data.map(d => d[5]).join('\n')}`
}
