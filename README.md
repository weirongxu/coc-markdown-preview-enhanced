# coc-markdown-preview-enhanced

[Markdown Preview Enhanced](https://shd101wyy.github.io/markdown-preview-enhanced/) ported to coc.nvim

## Introduction

> Markdown Preview Enhanced is an extension that provides you with many useful functionalities such as automatic scroll sync, [math typesetting](https://shd101wyy.github.io/markdown-preview-enhanced/#/math), [mermaid](https://shd101wyy.github.io/markdown-preview-enhanced/#/diagrams?id=mermaid), [PlantUML](https://shd101wyy.github.io/markdown-preview-enhanced/#/diagrams?id=plantuml), [pandoc](https://shd101wyy.github.io/markdown-preview-enhanced/#/pandoc), PDF export, [code chunk](https://shd101wyy.github.io/markdown-preview-enhanced/#/code-chunk), [presentation writer](https://rawgit.com/shd101wyy/markdown-preview-enhanced/master/docs/presentation-intro.html), etc. A lot of its ideas are inspired by [Markdown Preview Plus](https://github.com/atom-community/markdown-preview-plus) and [RStudio Markdown](http://rmarkdown.rstudio.com/).

## Required

- [coc-webview](https://github.com/weirongxu/coc-webview)

## Install

`:CocInstall coc-markdown-preview-enhanced`

## Commands

`:CocCommand markdown-preview-enhanced.openPreview`

| Command                                    | Functionality              |
| ------------------------------------------ | -------------------------- |
| markdown-preview-enhanced.openPreview      | Open preview               |
| markdown-preview-enhanced.syncPreview      | Sync preview / Sync source |
| markdown-preview-enhanced.runCodeChunk     | Run code chunk             |
| markdown-preview-enhanced.runAllCodeChunks | Run all code chunks        |

**Enable the `Run code chunk` feature**

> _Note: Please use this feature with caution because it may put your security at risk! Your machine can get hacked if someone makes you open a markdown with malicious code while script execution is enabled._

```json
{
  "markdown-preview-enhanced.enableScriptExecution": true
}
```

More `:CocList --input=markdown-preview-enhanced. commands`

## Keybindings

| Shortcuts      | Functionality      |
| -------------- | ------------------ |
| <kbd>esc</kbd> | Toggle sidebar TOC |

## Configurations

https://github.com/neoclide/coc.nvim/wiki/Using-the-configuration-file

## Acknowledgements

The implementation of this project relies on `vscode-markdown-preview-enhanced` and `mume`.

- [shd101wyy/vscode-markdown-preview-enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
- [shd101wyy/mume](https://github.com/shd101wyy/mume)

## License

[University of Illinois/NCSA Open Source License](./LICENSE.md)

---

> This extension is built with [create-coc-extension](https://github.com/fannheyward/create-coc-extension)
