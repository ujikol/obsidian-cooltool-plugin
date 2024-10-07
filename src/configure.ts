import { Command, Notice, Vault } from 'obsidian'
import { CoolToolPlugin } from "./types.d"
import { merge, unionWith } from 'es-toolkit'
const path = require('path')
const fs = require('fs-extra')


let changed = false

export const configureDefaultSettingsCommand = (plugin: CoolToolPlugin): Command => ({
    id: 'configure-default-settings',
    name: 'Configure default settings',
    callback: () => {
        const neededInternalPlugins = ["backlink", "bookmarks", "command-palette", "file-explorer", "file-recovery", "global-search", "graph", "outgoing-link", "outline", "properties", "tag-pane", "templates", "workspaces"]
        // const neededCommunityPlugins = ["cooltool", "quick-outliner", "heading-status-plugin", "obsidian-tasks-plugin", "dataview", 'datepicker', 'waypoint', 'folder-notes', 'obsidian-trash-explorer', 'table-editor-obsidian',
        //     'note-refactor-obsidian', 'darlal-switcher-plus', 'toggle-dark-mode', "obsidian-meta-bind-plugin", 'at-symbol-linking', 'editing-toolbar', 'enhanced-symbols-prettifier', 'nldates-obsidian', 'highlight-active-folder-section']
        const neededCommunityPlugins = ["cooltool", "quick-outliner", "heading-status-plugin", "obsidian-tasks-plugin", "dataview", 'datepicker', 'waypoint', 'folder-notes', 'obsidian-trash-explorer', 'table-editor-obsidian',
            'darlal-switcher-plus', "obsidian-meta-bind-plugin", 'at-symbol-linking', 'editing-toolbar', 'enhanced-symbols-prettifier', 'nldates-obsidian', 'highlight-active-folder-section']
        neededInternalPlugins.forEach((p: string) => {
            // const obj = plugin.app.internalPlugins.config
            const obj = plugin.app.internalPlugins.plugins
            const prop = p as keyof typeof obj
            const obj2 = obj[prop] as {enabled: boolean}
            if (obj2.enabled)
                return
            (obj[prop] as {enabled: boolean}).enabled = true
            new Notice(`Enabled plugin '${p}'.`)
            // const msg = `ERROR:\nCore plugin '${p}' needs to be enabled.`
            // new Notice(msg)
            // throw msg
        })
        neededCommunityPlugins.forEach((p: string) => {
            if (plugin.app.plugins.enabledPlugins.has(p))
                return
            const msg = `ERROR:\nCommunity plugin '${p}' needs to be installed and enabled.`
            new Notice(msg)
            throw msg
        })
        const vault = plugin.app.vault
        // graph and local graph ================
        patchFile("graph", vault, (c: any) => {
            let add = JSON.parse(`[
    {
      "query": "path:\\"Cyber AT/Team/Recruiting\\"  ",
      "color": {
        "a": 1,
        "rgb": 7763281
      }
    },
    {
      "query": "path:\\"Cyber AT/Team\\"  ",
      "color": {
        "a": 1,
        "rgb": 16773463
      }
    },
    {
      "query": "path:\\"Cyber AT/Projects\\"  ",
      "color": {
        "a": 1,
        "rgb": 16734807
      }
    },
    {
      "query": "path:\\"CT_Projects\\"",
      "color": {
        "a": 1,
        "rgb": 5395168
      }
    },
    {
      "query": "path:\\"Cyber AT/People/Atos Eviden\\"  ",
      "color": {
        "a": 1,
        "rgb": 16766295
      }
    },
    {
      "query": "path:\\"Cyber AT/People/Extern\\"  ",
      "color": {
        "a": 1,
        "rgb": 16746547
      }
    },
    {
      "query": "path:\\"CyberA AT/Programs\\"  ",
      "color": {
        "a": 1,
        "rgb": 16734176
      }
    }
  ]`)
            c.colorGroups = unionWith(c.colorGroups, add, (o:any, n:any) => o.query === n.query)
            // plugin.app.internalPlugins.disablePlugin("graph").then( () =>
            //   plugin.app.internalPlugins.enablePlugin("graph"))
            // const p = plugin.app.internalPlugins.plugins.graph
            // p.unload()
            // p.loadData()
            // p.load()
        })

        // Hotkeys ==============================
        patchFile("hotkeys", vault, (c: any) => {
            let add = JSON.parse(`{
  "insert-current-time": [
    {
      "modifiers": [
        "Mod",
        "Shift"
      ],
      "key": "D"
    }
  ],
  "workspace:new-tab": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "T"
    }
  ],
  "file-explorer:open": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "F"
    }
  ],
  "bookmarks:open": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "B"
    }
  ],
  "graph:open-local": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "G"
    }
  ],
  "table-editor-obsidian:table-control-bar": [],
  "note-refactor-obsidian:app:extract-selection-first-line": [],
  "note-refactor-obsidian:app:extract-selection-content-only": [],
  "darlal-switcher-plus:switcher-plus:open-commands": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "P"
    },
    {
      "modifiers": [],
      "key": "F24"
    }
  ],
  "command-palette:open": [],
  "darlal-switcher-plus:switcher-plus:open": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "J"
    }
  ],
  "darlal-switcher-plus:switcher-plus:open-starred": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "B"
    }
  ],
  "editor:toggle-bold": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "B"
    }
  ],
  "editor:toggle-checklist-status": [],
  "editor:toggle-italics": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "I"
    }
  ],
  "editor:toggle-blockquote": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "B"
    }
  ],
  "editor:toggle-code": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "C"
    }
  ],
  "editor:toggle-bullet-list": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "L"
    }
  ],
  "editor:toggle-fold-properties": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "P"
    }
  ],
  "editor:set-heading": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "H"
    }
  ],
  "editor:toggle-highlight": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "H"
    }
  ],
  "editor:toggle-inline-math": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "M"
    }
  ],
  "editor:toggle-strikethrough": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "S"
    }
  ],
  "workspace:next-tab": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "ArrowRight"
    }
  ],
  "workspace:previous-tab": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "ArrowLeft"
    }
  ],
  "workspace:undo-close-pane": [],
  "editor:save-file": [
    {
      "modifiers": [
        "Mod",
        "Shift"
      ],
      "key": "S"
    }
  ],
  "obsidian-excalidraw-plugin:save": [
    {
      "modifiers": [
        "Mod",
        "Shift"
      ],
      "key": "S"
    }
  ],
  "heading-status-plugin:change-status": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "S"
    }
  ],
  "obsidian-tasks-plugin:edit-task": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "T"
    }
  ],
  "obsidian-tasks-plugin:toggle-done": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "T"
    }
  ],
  "app:go-back": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "ArrowUp"
    }
  ],
  "app:go-forward": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "ArrowDown"
    }
  ],
  "file-explorer:new-file-in-current-tab": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "N"
    }
  ],
  "workspace:close": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "Q"
    }
  ],
  "workspace:close-others": [
    {
      "modifiers": [
        "Alt",
        "Mod",
        "Shift"
      ],
      "key": "Q"
    }
  ],
  "datepicker:insert-datetime": [
    {
      "modifiers": [
        "Alt"
      ],
      "key": "D"
    }
  ],
  "datepicker:edit-datetime": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "D"
    }
  ],
  "file-explorer:reveal-active-file": [
    {
      "modifiers": [
        "Mod",
        "Shift"
      ],
      "key": "J"
    }
  ],
  "editor:follow-link": [
    {
      "modifiers": [
        "Mod"
      ],
      "key": "Enter"
    }
  ],
  "editor:open-link-in-new-leaf": [],
  "toggle-dark-mode:toggle-dark-mode": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "D"
    }
  ],
  "properties:open": [
    {
      "modifiers": [
        "Alt",
        "Mod"
      ],
      "key": "P"
    }
  ],
  "properties:open-local": [
    {
      "modifiers": [
        "Alt",
        "Shift"
      ],
      "key": "P"
    }
  ]
            }`)
            merge(c, add)
        })
        

        // More above this ======================
        if (changed)
            plugin.app.commands.commands["app:reload"].callback()
        else
            new Notice("NO CHANGES!")
    }
})

function patchFile(fileName: string, vault: Vault, patchFunction: (any)) {
    try {
        const configPath = path.join(vault.adapter.basePath, vault.configDir)
        let filePath = path.join(configPath, fileName+".json")
        const config = JSON.parse(fs.readFileSync(filePath))
        const oldJson = JSON.stringify(config, null, 2)
        patchFunction(config)
        const json = JSON.stringify(config, null, 2)
        if (json != oldJson) {
            fs.copySync(filePath, filePath.replace(".json", `_${this.moment(Date.now()).format("YYYYMMDDHHmm")}.json`))
            fs.writeFileSync(filePath, json)
            changed = true
            console.log("CT: patched", filePath)
        }
    } catch (err) {
        console.log(err)
        if (typeof err === "string")
            new Notice(`ERROR:\n${err}`)
        else
            new Notice(`${err.name}\n${err.message}`)
        // throw err
    }
}