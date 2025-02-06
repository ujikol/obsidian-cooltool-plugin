// import { requestUrl, RequestUrlResponse } from 'obsidian'
import {curlGetRequest} from './curl'
import * as fs from 'fs'
// import { Moment } from 'moment';
// import * as moment from 'moment'
// const moment = require('moment-business-days')
import { DateTime } from 'luxon-business-days'
import { getMarkdownTable } from "markdown-table-ts"
import { sum, zip } from "es-toolkit"
// import { Moment } from 'moment'


interface Config {
    credentials: string;
    // domain: string;
    baseURL: string;
    // certPath: string;
    // cert: Buffer;
}

export class RetainAPI {
    private config: Config;

    constructor(configFilePath: string) {
        this.config = this.loadConfig(configFilePath);
    }

    // Load config from a local JSON file
    private loadConfig(filePath: string): Config {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const config = JSON.parse(fileContent) as Config;
            // config.cert = fs.readFileSync(config.certPath);
            return config;
        } catch (error) {
            console.error('Error loading config:', error);
            throw new Error('Failed to load config for NTLM authentication.');
        }
    }

    // Utility function to format data into a Markdown table
    private formatMarkdownTable(headers: string[], rows: string[][]): string {
        const headerRow = `| ${headers.join(' | ')} |`;
        const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
        const dataRows = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
        return [headerRow, separatorRow, dataRows].join('\n');
    }

    // // Helper method to make requests with NTLM authentication headers
    // private async makeRequest(endpoint: string, params?: Record<string, any>): Promise<RequestUrlResponse> {
    //     const url = `${this.config.baseURL}${endpoint}`;
    //     const authHeader = 'Basic ' + Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

    //     try {
    //         const response = await requestUrl({
    //             url,
    //             headers: {
    //                 Authorization: authHeader,
    //                 'Access-Control-Allow-Origin': '*',
    //             },
    //             contentType: 'application/json',
    //             method: params ? 'POST' : 'GET',
    //             body: params ? JSON.stringify(params) : undefined,
    //         });

    //         return response;
    //     } catch (error) {
    //         console.error('Request failed:', error);
    //         throw new Error(`Failed to make request to ${url}`);
    //     }
    // }

    async request(endpoint: string, query?: any, debug=false): Promise<object> {
        let params: string[]|undefined
        if (query) {
            params = ["sqlquery=" + JSON.stringify(query)]
        }
        const response = await curlGetRequest(this.config.baseURL + endpoint, params, this.config.credentials, debug)
        // console.log("XXXz", response)
        return JSON.parse(response)
    }

    async getAllResourcesAsMarkdown(): Promise<string> {
        const resources = await this.request('/table/RES/') as any[]
        const headers = ['ID', 'Description', 'User Logon', 'Role Name', 'Email', 'Status']
        const rows = resources.map((resource: any) => [
            resource.RES.RES_ID,
            resource.RES.RES_DESCR,
            resource.RES.RES_USRLOGON,
            resource.RES.RES_ROLENAME,
            resource.RES.RES_EMAIL || 'N/A',
            resource.RES.RES_RST_ID_DESCR,
        ])
        return this.formatMarkdownTable(headers, rows);
    }

    async getAllResources(): Promise<any[]> {
        const response = await this.request('/table/RES/',
            {"filter": 
                {"and": [
                    {"table": "RES", "field": "RES_RST_ID", "operator": "=", "value": 1},
                    {"or": [
                        {"table": "RES", "field": "RES_LOGIC1_BIT", "operator": "=", "value": 1},
                        {"table": "RES", "field": "RES_ORGANIZATIONAL_UNIT", "operator": "LIKE", "value": "E AT BDS SEC%"},
                        {"table": "RES", "field": "RES_ORGANIZATIONAL_UNIT", "operator": "LIKE", "value": "E AT BDS CYB%"},
                        {"table": "RES", "field": "RES_ORGANIZATIONAL_UNIT", "operator": "LIKE", "value": "E GER BDS DS CE CySS GER ODS%"},
                        {"table": "RES", "field": "RES_ORGANIZATIONAL_UNIT", "operator": "LIKE", "value": "E GER BDS DS CE CySS GER ODS%"}
                    ]}
                ]}
            }) as any
        return (response.result.values as any[]).map(r=>r.RES)
    }

    async getProjectDataWithBookingsAsMarkdown(projectId: string): Promise<[string|undefined, string|undefined, string|undefined]> {
        let response = await this.request('/table/JOB/', {"filter": {"table": "JOB", "field": "JOB_CODE", "operator": "=", "value": projectId}}) as any
        let job = response.result.values[0]
        if (!job)
            return [undefined, undefined, undefined]
        job = job.JOB as any
        response = await this.request('/table/BKG/',{"filter": {"table": "BKG", "field": "BKG_JOB_ID", "operator": "=", "value": job.JOB_ID}})
            const bookings = (response.result.values as any[]).map(b=>b.BKG).filter(b => b.BKG_DELETED !== 1)
        let resources = []
        let teamOutput: string | undefined
        let allocationsOutput: string | undefined
        let resIDs = [...new Set(bookings.map(b=>b.BKG_RES_ID))]
        resIDs.push(job.JOB_AC_LEAD_RES_ID)
        resIDs.push(job.JOB_EM_LEAD_RES_ID)
        const filters = resIDs.map(r => ({"table": "RES", "field": "RES_ID", "operator": "=", "value": r}))
        response = await this.request('/table/RES/',{"filter": {"or": filters}})
        resources = (response.result.values as any[]).map(r=>r.RES)
        if (bookings.length > 0) {
            allocationsOutput = this.processBookings(bookings, resources)
        }

        // Job output
        const projectName = job["JOB_DESCR"] || "Unnamed Project"
        const client = job["JOB_CLT_ID_DESCR"] || "Unknown Client"
        const budgetPd = job["JOB_BUDGET_TIME"] / 8
        const pm = resources.find(r => r.RES_ID === job.JOB_EM_LEAD_RES_ID)
        const pdMap: {[id:number]:string} = {9922:"Web"}
        const jobOutput = `---
Nessie_ID: ${job["JOB_CODE"]}
Salesforce_ID: ${job["JOB_CODESF"]}
Project_Name: "${projectName}"
Client: "[[${client}]]"
PM: '[[${pm.RES_DESCR}\\|@${pm.RES_USRLOGON}]]'
Budget_PD: ${budgetPd}
Avg_PD_Rate: ${job["JOB_BUDGET_REVENUE"] / budgetPd || "N/A"}
Execution_Start: ${job["JOB_START"]?.slice(0, 10) || "Unknown Start Date"}
Language: en
Products:
  - "${pdMap[job.JOB_PRD_ID] || "Unknown Product"}"
Project_Folder: "S:\\\\EMEA\\\\Delivery_Auto\\\\${client[0]}\\\\${client}\\\\${job["JOB_CODE"]} ${projectName}"
Mailbox: 
aliases:
  - ${client} - ${projectName}
---
`

        // Team output
        teamOutput = getMarkdownTable({table: {
            head: ["M/C", "Name", "Role", "Email", "DAS_ID"],
            body: resources.map(res => [`[[${res.RES_DESCR}\\|@${res.RES_USRLOGON}]]`, res.RES_DESCR, res.RES_GCM_ID_DESCR, res.RES_EMAIL, res.RES_DASID])
        }})

        return [jobOutput, teamOutput, allocationsOutput]
    }
    
    private groupByAndSum(data: any[], keys: string[], sumField: string) {
        const grouped: Record<string, any> = {}
        data.forEach(row => {
            const key = keys.map(k => row[k]).join('-')
            if (!grouped[key]) {
                grouped[key] = { ...row }
            } else {
                grouped[key][sumField] += row[sumField]
            }
        })
        return Object.values(grouped)
    }

    processBookings(bookings: any[], resources: any[]): string {
        bookings = bookings
            .map(b => ({
                res: b.BKG_RES_ID,
                start: DateTime.fromISO(b.BKG_START.substring(0, 10)),
                end: DateTime.fromISO(b.BKG_END.substring(0, 10)),
                work: b.BKG_TIME
            }))
        bookings = this.groupByAndSum(bookings, ["res", "start", "end"], "work")

        // Generate daily entries for each business day between start and end
        const dailyEntries = bookings.flatMap(row => {
            const days = this.businessDaysBetween(row.start, row.end) as any[]
            const n = days.length
            return days.map((day: DateTime) => ({
                res: row.res,
                date: day,
                work: row.work / n
            }))
        })

        const dailyGrouped = this.groupByAndSum(dailyEntries, ["res", "date"], "work")

        // Round work values to reduce remainders
        const groupedByRes: Record<string, any[]> = {}
        dailyGrouped.forEach(row => {
            if (!groupedByRes[row.res]) groupedByRes[row.res] = []
            groupedByRes[row.res].push(row)
        })
        Object.values(groupedByRes).forEach(group => {
            let remainder = 0
            group.forEach(row => {
                const adjustedWork = row.work - remainder
                const roundedWork = Math.round(adjustedWork / 60)
                remainder = (roundedWork * 60) - adjustedWork
                row.work = roundedWork
            })
        })

        // Define shifts per resource per week
        let wks: number[] = []
        const shifts = Object.values(groupedByRes).map(group => {
            return this.groupByAndSum(group.map(row => {
                const week = row.date.startOf('week').toMillis()
                wks.push(week)
                return {
                    res: row.res,
                    week: week,
                    work: row.work / 8
                }
            }), ["res", "week"], "work")
        })

        // Prepare output
        wks = [...new Set(wks)].sort((a,b) => a - b)
        const rs: number[] = resources.map(r => r.RES_ID)
        let shiftsPivot: number[][] = wks.map(w => rs.map(r => 0))
        shifts.forEach(r => r.forEach(w => shiftsPivot[wks.indexOf(w.week)][rs.indexOf(w.res)] = w.work))
        const totals = []
        for (let i=0; i<rs.length; i++)
            totals.push(sum(shiftsPivot.map(r => r[i])))
        shiftsPivot.push(totals)
        shiftsPivot = shiftsPivot.map(w => [].concat.apply([], [[], w, [sum(w)]]))
        wks.push(-1)
        const shiftOutput = getMarkdownTable({table: {
            head: [].concat.apply([], [["Week", "Date"], resources.map(r => r.RES_USRLOGON), ["Total"]]),
            body: zip(wks, shiftsPivot).map(x => {
                const week = DateTime.fromMillis(x[0])
                return [].concat.apply([],
                [x[0] === -1 ? ["Total", ""] : [week.toISOWeekDate()!.substring(2,9), week.toFormat('YYYY-MM-DD')],
                x[1].map(n => n.toString()), [sum(x[1]).toString()]])})
        }})

        return shiftOutput
    }

    private businessDaysBetween(start: DateTime, end: DateTime): DateTime[] {
        let days: any[] = []
        let day = start
        while (day <= end) {
            days.push(day)
            day = day.plusBusiness()
        }
        return days
    }
}
    
    