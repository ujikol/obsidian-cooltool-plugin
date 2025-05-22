import { Notice } from 'obsidian'
import { PageMetadata } from "obsidian-dataview"
import { getMarkdownTable, Align } from "markdown-table-ts"
import { Chart, registerables } from 'chart.js'
const path = require('path')


Chart.register(...registerables);


/**
 * Calculates revenue and PDs by month for a list of projects,
 * optionally grouped, and filtered by an execution date range.
 *
 * @param dv The Dataview API object.
 * @param pages An array of PageMetadata objects, each representing a project.
 * @param group An optional string key to group projects by (e.g., 'Client') or a function that takes a PageMetadata object and returns the group key.
 * @param from_date Optional start date string for filtering projects and months (YYYY-MM-DD). Defaults to '2020-01-01'.
 * @param to_date Optional end date string for filtering projects and months (YYYY-MM-DD). Defaults to '2029-12-31'.
 */
export function getMonthlyRevenue(dv: any, pages: PageMetadata[], from_date?: string, to_date?: string, group?: string | ((p: PageMetadata) => any), sort?: "name" | "total" | "month"): {
        items: {
            id: string | any
            monthlyBreakdown: { [monthKey: string]: number }
            total: number
        }[];
        filteredSortedMonths: string[];
        monthlyPDTotals: { [monthKey: string]: number }
        monthlyRevenueTotals: { [monthKey: string]: number }
    } | string {

    const startDateString = from_date ?? '2020-01-01'
    const endDateString = to_date ?? '2029-12-31'
    const startDateFilter = dv.date(startDateString)
    const endDateFilter = dv.date(endDateString)
    if (!startDateFilter || !endDateFilter) {
        return `Error parsing date filters. Please ensure from_date ('${from_date}') and to_date ('${to_date}') are in-MM-DD format.`
    }
    const compare =
        (!sort || sort === "total") ?
            (a: any, b: any) => b.total - a.total
        : sort === "name" ?
            (a: any, b: any) => String(a.name ? a.name.display || a.name.path || a.name : a).localeCompare(String(b.name ? b.name.display || b.name.path || b.name: b))
        : (a: any, b: any) => (filteredSortedMonths.map(monthKey => a.monthlyBreakdown[monthKey] || 0).findIndex((v: number) => v > 0) - filteredSortedMonths.map(monthKey => b.monthlyBreakdown[monthKey] || 0).findIndex((v: number) => v > 0))

    let allProjectsMonthlyData: {
        name: any;
        monthlyBreakdown: { [monthKey: string]: number }
        total: number;
        groupValue: any;
    }[] = []
    let monthlyRevenueTotals: { [monthKey: string]: number } = {}
    let monthlyPDTotals: { [monthKey: string]: number } = {}
    let allMonths = new Set<string>()

    for (const page of pages) {
        const start = page.Execution_Start
        const end = page.Execution_End
        const budget = page.Budget_PD
        const rate = page.Avg_PD_Rate

        if (!(start && end && start.isValid && end.isValid && start <= end && typeof budget === 'number' && typeof rate === 'number')) {
            if (page.Nessie_ID || !page.Salesforce_ID) {
                const text = `Invalid project data for ${page.file.link}. Ensure Execution_Start, Execution_End, Budget_PD, and Avg_PD_Rate are valid.`
                new Notice(text)
                console.warn(text)
            }
            continue
        }

        const totalProjectRevenue = budget * rate
        let workingDaysInRange = 0
        let currentDay = start

        // Calculate working days within the project duration (start to end)
        while (currentDay && end && currentDay <= end) {
            if (currentDay.weekday >= 1 && currentDay.weekday <= 5) {
                workingDaysInRange++
            }
            currentDay = currentDay.plus({ days: 1 })
        }

        if (workingDaysInRange === 0) {
            // Avoid division by zero if a project has no working days in its range (e.g., weekend-only project)
            // const text = `Project ${page.file.link} has no working days between ${start.toFormat('yyyy-MM-dd')} and ${end.toFormat('yyyy-MM-dd')}. Skipping.`
            // new Notice(text)
            // console.warn(text)
            continue;
        }

        const dailyWorkingRevenue = totalProjectRevenue / workingDaysInRange
        const dailyWorkingPD = budget / workingDaysInRange

        const projectMonthlyBreakdown: { [monthKey: string]: number } = {}
        currentDay = start

        // Calculate monthly breakdown of revenue and PDs for the project's full duration
        while (currentDay && end && currentDay <= end) {
            if (currentDay.weekday >= 1 && currentDay.weekday <= 5) {
                const monthKey = currentDay.toFormat('yyyy-MM')
                projectMonthlyBreakdown[monthKey] = (projectMonthlyBreakdown[monthKey] || 0) + dailyWorkingRevenue
                monthlyRevenueTotals[monthKey] = (monthlyRevenueTotals[monthKey] || 0) + dailyWorkingRevenue
                monthlyPDTotals[monthKey] = (monthlyPDTotals[monthKey] || 0) + dailyWorkingPD
                allMonths.add(monthKey)
            }
            currentDay = currentDay.plus({ days: 1 })
        }

        let pageGroupValue: any = null;
        if (typeof group === 'string') {
            pageGroupValue = page[group];
        } else if (typeof group === 'function') {
            pageGroupValue = group(page);
        } else {
            pageGroupValue = null;
        }


        allProjectsMonthlyData.push({
            name: page.file.link,
            monthlyBreakdown: projectMonthlyBreakdown,
            total: totalProjectRevenue,
            groupValue: pageGroupValue
        })
    }

    const sortedMonths = Array.from(allMonths).sort()

    // Filter the sorted months to only include those within the startDateFilter/endDateFilter range for display
    const filteredSortedMonths = sortedMonths.filter(monthKey => {
        const monthStart = dv.date(monthKey)
        const monthEnd = monthStart.endOf('month')
        return monthEnd >= startDateFilter && monthStart <= endDateFilter
    })

    if (filteredSortedMonths.length === 0) {
            if (allProjectsMonthlyData.length > 0)
                return `No months between ${startDateFilter.toFormat('yyyy-MM')} and ${endDateFilter.toFormat('yyyy-MM')} contain working days from the selected projects.`
            else
                return `No projects found with valid revenue or budget data with execution dates between ${startDateFilter.toFormat('yyyy-MM-dd')} and ${endDateFilter.toFormat('yyyy-MM-dd')}.`
        }

    let items: {
        id: string | any;
        monthlyBreakdown: { [monthKey: string]: number };
        total: number;
    }[] = []

    if (group) {
        const groupedData: { [key: string]: { monthlyBreakdown: { [monthKey: string]: number }, total: number } } = {}

        for (const project of allProjectsMonthlyData) {
            let key = project.groupValue
            if (key === undefined || key === null || (typeof key === 'string' && key.trim() === '')) {
                key = 'Unspecified'
            } else if (typeof key === 'object' && key.display) {
                key = key.display
            } else {
                key = String(key)
            }

            if (!groupedData[key]) {
                groupedData[key] = {
                    monthlyBreakdown: {},
                    total: 0
                }
            }

            for (const month in project.monthlyBreakdown) {
                    if (filteredSortedMonths.includes(month)) {
                        if (!groupedData[key].monthlyBreakdown[month]) {
                            groupedData[key].monthlyBreakdown[month] = 0
                        }
                        const monthlyAmount = project.monthlyBreakdown[month]
                        groupedData[key].monthlyBreakdown[month] += monthlyAmount
                        groupedData[key].total += monthlyAmount
                    }
                }
        }

        const sortedKeys = sort === "name" ? Object.keys(groupedData).sort() : Object.keys(groupedData).sort((a, b) => compare(groupedData[a], groupedData[b]))
        items = sortedKeys.map(groupKey => {
            const groupData = groupedData[groupKey]
            return {
                id: groupKey,
                monthlyBreakdown: groupData.monthlyBreakdown,
                total: groupData.total
            }
        })

    } else {
        items = allProjectsMonthlyData
            .sort(compare)
            .map(project => {
                let projectTotalRevenueDisplayed = 0
                for (const monthKey of filteredSortedMonths) {
                        projectTotalRevenueDisplayed += project.monthlyBreakdown[monthKey] || 0
                }
                return {
                    id: project.name,
                    monthlyBreakdown: project.monthlyBreakdown,
                    total: projectTotalRevenueDisplayed
                }
            })
    }

    return { items, filteredSortedMonths, monthlyPDTotals, monthlyRevenueTotals }
}


/**
 * Calculates and displays revenue and PDs by month for a list of projects,
 * optionally grouped, and filtered by an execution date range.
 *
 * @param dv The Dataview API object.
 * @param pages An array of PageMetadata objects, each representing a project.
 * @param group An optional string key to group projects by (e.g., 'Client').
 * @param from_date Optional start date string for filtering projects and months (YYYY-MM-DD). Defaults to '2000-01-01'.
 * @param to_date Optional end date string for filtering projects and months (YYYY-MM-DD). Defaults to '2099-12-31'.
 */
export function monthlyRevenuesTable(dv: any, pages: PageMetadata[], from_date?: string, to_date?: string, group?: string | ((p: PageMetadata) => any), sort?: "name" | "total" | "month"): void {

    const result = getMonthlyRevenue(dv, pages, from_date, to_date, group, sort);
    if (typeof result === 'string')
        return dv.paragraph(result)
    const { items, filteredSortedMonths, monthlyPDTotals, monthlyRevenueTotals } = result;

    const headers: (string | any)[] = [
        "Project",
        "Total",
        ...filteredSortedMonths.map(monthKey => dv.date(monthKey).toFormat('MMM yy'))
    ]

    // Build PD Totals row
    const pdTotalsRow: (string | number)[] = ["**PD Total**"]
    let grandTotalPDDisplayed = 0
    for (const monthKey of filteredSortedMonths) {
        grandTotalPDDisplayed += monthlyPDTotals[monthKey] || 0
    }
    pdTotalsRow.push(`**${grandTotalPDDisplayed.toFixed(2)}**`)
    for (const monthKey of filteredSortedMonths) {
        const monthPDTotal = monthlyPDTotals[monthKey] || 0
        pdTotalsRow.push(`**${monthPDTotal.toFixed(2)}**`)
    }


    // Build Revenue Totals row and calculate grand total for the filtered months
    const revenueTotalsRow: (string | number)[] = ["**Revenue Total**"]
    let grandTotalRevenueDisplayed = 0
    for (const monthKey of filteredSortedMonths) {
        grandTotalRevenueDisplayed += monthlyRevenueTotals[monthKey] || 0
    }
    revenueTotalsRow.push(`**${grandTotalRevenueDisplayed.toFixed(2)}**`)
    for (const monthKey of filteredSortedMonths) {
        const monthRevenueTotal = monthlyRevenueTotals[monthKey] || 0
        revenueTotalsRow.push(`**${monthRevenueTotal.toFixed(2)}**`)
    }

    let itemRows: (string | any)[][] = []

    itemRows = items.map(item => {
        const row: (string | number | any)[] = [item.id]
        row.push(item.total.toFixed(2))

        for (const monthKey of filteredSortedMonths) {
            const monthlyAmount = item.monthlyBreakdown[monthKey] || 0
            row.push(monthlyAmount.toFixed(2))
        }
        return row
    })


    // Combine the total rows and item rows
    const tableRows = [pdTotalsRow, revenueTotalsRow, ...itemRows]

    // Generate and display the markdown table
    const alignment: Align[] = [Align.Left, Align.Right, ...Array(filteredSortedMonths.length).fill(Align.Right)]
    const markdownTable = getMarkdownTable({
        table: {
            head: headers,
            body: tableRows.map(row => row.map(cell => String(cell).replace(/\|/g, "\\|"))),
        },
        alignment: alignment,
    })
    dv.paragraph(markdownTable)
}

// /**
//  * Calculates and plot revenue and PDs by month for a list of projects,
//  * optionally grouped, and filtered by an execution date range.
//  *
//  * @param dv The Dataview API object.
//  * @param pages An array of PageMetadata objects, each representing a project.
//  * @param group An optional string key to group projects by (e.g., 'Client').
//  * @param from_date Optional start date string for filtering projects and months (YYYY-MM-DD). Defaults to '2000-01-01'.
//  * @param to_date Optional end date string for filtering projects and months (YYYY-MM-DD). Defaults to '2099-12-31'.
//  */
// export function monthlyRevenuesChart(dv: any, pages: PageMetadata[], group?: string | null, from_date?: string | null, to_date?: string | null): void {

//     const result = getMonthlyRevenue(dv, pages, group, from_date, to_date);
//     if (typeof result === 'string')
//         return dv.paragraph(result)
//     const { items, filteredSortedMonths } = result

//     const seriesData = items.reverse().map(item => {
//         let title: string
//         if (typeof item.id === 'object')
//             if (item.id.display)
//                 title = item.id.display
//             else
//                 title = path.basename(item.id.path).split('.')[0]
//         else {
//             const matches = item.id.match(/\[\[.+\|(.+)\]\]/)
//             if (matches)
//                 title = matches[1]
//             else
//                 title = item.id
//         }
//         return `\n - title: ${title}\n - data: [${filteredSortedMonths.map((monthKey: string) => item.monthlyBreakdown[monthKey] || 0).join(", ")}]`
//     }).join("")

//     const code = `
// type: bar
// labels: [${filteredSortedMonths.map(monthKey => `"${dv.date(monthKey).toFormat('MMM yy')}"`).join(", ")}]
// series:${seriesData}
// stacked: true
// yMin: 0
// `
//     dv.paragraph("```chart" + code + "```")
// }


// function renderRaw(data: any, el: HTMLElement): Chart | null {
//     const destination = el.createEl('canvas');

//     if (data.chartOptions) {
//         try {
//             let chart = new Chart(destination.getContext("2d")!, data.chartOptions);
//             destination.parentElement!.style.width = data.width ?? "100%";
//             destination.parentElement!.style.margin = "auto";
//             return chart;
//         } catch (error) {
//             renderError(error, el);
//             return null;
//         }
//     } else {
//         try {
//             let chart = new Chart(destination.getContext("2d")!, data);
//             return chart;
//         } catch (error) {
//             renderError(error, el);
//             return null;
//         }
//     }
// }


// function renderError(error: any, el: HTMLElement) {
//     const errorEl = el.createDiv({ cls: "chart-error" });
//     errorEl.createEl("b", { text: "Couldn't render Chart:" });
//     errorEl.createEl("pre").createEl("code", { text: error.toString?.() ?? error });
//     errorEl.createEl("hr");
//     errorEl.createEl("span").innerHTML = "You might also want to look for further Errors in the Console: Press <kbd>CTRL</kbd> + <kbd>SHIFT</kbd> + <kbd>I</kbd> to open it.";
// }


/**
 * Calculates and plot revenue and PDs by month for a list of projects,
 * optionally grouped, and filtered by an execution date range.
 *
 * @param dv The Dataview API object.
 * @param pages An array of PageMetadata objects, each representing a project.
 * @param group An optional string key to group projects by (e.g., 'Client').
 * @param from_date Optional start date string for filtering projects and months (YYYY-MM-DD). Defaults to '2000-01-01'.
 * @param to_date Optional end date string for filtering projects and months (YYYY-MM-31').
 */
export function monthlyRevenuesChart(dv: any, pages: PageMetadata[], from_date?: string, to_date?: string, group?: string | ((p: PageMetadata) => any), sort?: "name" | "total" | "month"): void {

    const result = getMonthlyRevenue(dv, pages, from_date, to_date, group, sort);
    if (typeof result === 'string')
        return dv.paragraph(result)
    const { items, filteredSortedMonths } = result

    const labels = filteredSortedMonths.map(monthKey => dv.date(monthKey).toFormat('MMM yy'));

    const datasets = items.map(item => {
        let title: string
        if (typeof item.id === 'object')
            if (item.id.display)
                title = item.id.display
            else
                title = item.id.path.split('/').pop().split('.')[0]
        else {
            const matches = item.id.match(/\[\[.+\|(.+)\]\]/)
            if (matches)
                title = matches[1]
            else
                title = item.id
        }
        return {
            label: title,
            data: filteredSortedMonths.map((monthKey: string) => item.monthlyBreakdown[monthKey] || 0),
            // Example colors, these can be customized or generated dynamically
            backgroundColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, 0.7)`,
            borderColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, 1)`,
            borderWidth: 1
        }
    });

    const canvas = dv.container.createEl('canvas');
    const ctx = canvas.getContext('2d');

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            scales: {
                x: {
                    stacked: true,
                },
                y: {
                    stacked: true,
                    beginAtZero: true
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Monthly Revenue Breakdown'
                }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });
}
