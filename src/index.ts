import { getExtensionConfigPath, utility } from '@shd101wyy/mume';
import { commands, events, ExtensionContext, Position, Range, TextEdit, Uri, window, workspace } from 'coc.nvim';
import path from 'path';
import { pasteImageFile, uploadImageFile } from './image-helper';
import { getPreviewUri, isMarkdownFile, MarkdownPreviewEnhancedView } from './preview-content-provider';
import { logger } from './util';

let editorScrollDelay = Date.now();

async function openVsplit(uri: Uri) {
  const nvim = workspace.nvim;
  const escapedPath = await workspace.nvim.call('fnameescape', [uri.fsPath]);
  nvim.pauseNotification();
  nvim.command('vsplit', true);
  nvim.command(`edit ${escapedPath}`, true);
  if (workspace.isVim) {
    // Avoid vim highlight not working,
    // https://github.com/weirongxu/coc-explorer/issues/113
    nvim.command('redraw', true);
  }
  await nvim.resumeNotification();
}

// this method is called when your extension iopenTextDocuments activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
  // assume only one preview supported.
  const contentProvider = new MarkdownPreviewEnhancedView(context);

  async function openPreview(uri?: Uri) {
    const doc = await workspace.document;
    let resource = uri;
    if (!(resource instanceof Uri)) {
      // we are relaxed and don't check for markdown files
      resource = Uri.parse(doc.uri);
    }
    await contentProvider.initPreview(resource, doc);
  }

  function toggleScrollSync() {
    const config = workspace.getConfiguration('markdown-preview-enhanced');
    const scrollSync = !config.get<boolean>('scrollSync');
    config.update('scrollSync', scrollSync, true);
    contentProvider.updateConfiguration();
    if (scrollSync) {
      void window.showInformationMessage('Scroll Sync is enabled');
    } else {
      void window.showInformationMessage('Scroll Sync is disabled');
    }
  }

  function toggleLiveUpdate() {
    const config = workspace.getConfiguration('markdown-preview-enhanced');
    const liveUpdate = !config.get<boolean>('liveUpdate');
    config.update('liveUpdate', liveUpdate, true);
    contentProvider.updateConfiguration();
    if (liveUpdate) {
      void window.showInformationMessage('Live Update is enabled');
    } else {
      void window.showInformationMessage('Live Update is disabled');
    }
  }

  function toggleBreakOnSingleNewLine() {
    const config = workspace.getConfiguration('markdown-preview-enhanced');
    const breakOnSingleNewLine = !config.get<boolean>('breakOnSingleNewLine');
    config.update('breakOnSingleNewLine', breakOnSingleNewLine, true);
    contentProvider.updateConfiguration();
    if (breakOnSingleNewLine) {
      void window.showInformationMessage('Break On Single New Line is enabled');
    } else {
      void window.showInformationMessage('Break On Single New Line is disabled');
    }
  }

  async function customizeCSS() {
    const globalStyleLessFile = utility.addFileProtocol(path.resolve(getExtensionConfigPath(), './style.less'));
    await openVsplit(Uri.parse(globalStyleLessFile));
  }

  async function openMermaidConfig() {
    const mermaidConfigFilePath = utility.addFileProtocol(
      path.resolve(getExtensionConfigPath(), './mermaid_config.js'),
    );
    await openVsplit(Uri.parse(mermaidConfigFilePath));
  }

  async function openMathJaxConfig() {
    const mathjaxConfigFilePath = utility.addFileProtocol(
      path.resolve(getExtensionConfigPath(), './mathjax_config.js'),
    );
    await openVsplit(Uri.parse(mathjaxConfigFilePath));
  }

  async function openKaTeXConfig() {
    const katexConfigFilePath = utility.addFileProtocol(path.resolve(getExtensionConfigPath(), './katex_config.js'));
    await openVsplit(Uri.parse(katexConfigFilePath));
  }

  async function extendParser() {
    const parserConfigPath = utility.addFileProtocol(path.resolve(getExtensionConfigPath(), './parser.js'));
    await openVsplit(Uri.parse(parserConfigPath));
  }

  async function showUploadedImages() {
    const imageHistoryFilePath = utility.addFileProtocol(path.resolve(getExtensionConfigPath(), './image_history.md'));
    await openVsplit(Uri.parse(imageHistoryFilePath));
  }

  async function cursorPosition() {
    const win = await workspace.nvim.window;
    const cursor = await win.cursor;
    return Position.create(cursor[0], cursor[1]);
  }

  async function insertNewSlide() {
    const doc = await workspace.document;
    await doc.applyEdits([TextEdit.insert(await cursorPosition(), '<!-- slide -->\n')]);
  }

  async function insertPagebreak() {
    const doc = await workspace.document;
    await doc.applyEdits([TextEdit.insert(await cursorPosition(), '<!-- pagebreak -->\n')]);
  }

  async function createTOC() {
    const doc = await workspace.document;
    await doc.applyEdits([
      TextEdit.insert(
        await cursorPosition(),
        '\n<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->\n',
      ),
    ]);
  }

  async function insertTable() {
    const doc = await workspace.document;
    await doc.applyEdits([
      TextEdit.insert(
        await cursorPosition(),
        `|   |   |
|---|---|
|   |   |
`,
      ),
    ]);
  }

  async function openImageHelper() {
    await contentProvider.openImageHelper(Uri.parse((await workspace.document).uri));
  }

  function webviewFinishLoading(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.updateMarkdown(sourceUri);
  }

  /**
   * Insert imageUrl to markdown file
   * @param uri: markdown source uri
   * @param imageUrl: url of image to be inserted
   */
  async function insertImageUrl(uri: string, imageUrl: string) {
    const doc = workspace.getDocument(uri);
    if (doc && isMarkdownFile(doc.textDocument)) {
      await doc.applyEdits([TextEdit.insert(await cursorPosition(), `![enter image description here](${imageUrl})`)]);
    }
  }

  function refreshPreview(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.refreshPreview(sourceUri);
  }

  function openInBrowser(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.openInBrowser(sourceUri);
  }

  function htmlExport(uri: string, offline: boolean) {
    const sourceUri = Uri.parse(uri);
    contentProvider.htmlExport(sourceUri, offline);
  }

  function chromeExport(uri: string, type: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.chromeExport(sourceUri, type);
  }

  function princeExport(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.princeExport(sourceUri);
  }

  function eBookExport(uri: string, fileType: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.eBookExport(sourceUri, fileType);
  }

  function pandocExport(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.pandocExport(sourceUri);
  }

  function markdownExport(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.markdownExport(sourceUri);
  }

  /*
	function cacheSVG(uri, code, svg) {
		const sourceUri = Uri.parse(uri);
		contentProvider.cacheSVG(sourceUri, code, svg)
	}
	*/

  function cacheCodeChunkResult(uri: string, id: string, result: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.cacheCodeChunkResult(sourceUri, id, result);
  }

  function runCodeChunk(uri: string, codeChunkId: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.runCodeChunk(sourceUri, codeChunkId);
  }

  function runAllCodeChunks(uri: string) {
    const sourceUri = Uri.parse(uri);
    contentProvider.runAllCodeChunks(sourceUri);
  }

  async function runAllCodeChunksCommand() {
    const doc = await workspace.document;
    if (!isMarkdownFile(doc.textDocument)) {
      return;
    }

    const sourceUri = Uri.parse(doc.uri);
    const previewUri = getPreviewUri(sourceUri);
    if (!previewUri) {
      return;
    }

    contentProvider.previewPostMessage(sourceUri, {
      command: 'runAllCodeChunks',
    });
  }

  async function runCodeChunkCommand() {
    const doc = await workspace.document;
    if (!isMarkdownFile(doc.textDocument)) {
      return;
    }

    const sourceUri = Uri.parse(doc.uri);
    const previewUri = getPreviewUri(sourceUri);
    if (!previewUri) {
      return;
    }
    contentProvider.previewPostMessage(sourceUri, {
      command: 'runCodeChunk',
    });
  }

  async function syncPreview() {
    const doc = await workspace.document;
    if (!isMarkdownFile(doc.textDocument)) {
      return;
    }

    const sourceUri = Uri.parse(doc.uri);
    contentProvider.previewPostMessage(sourceUri, {
      command: 'changeTextEditorSelection',
      line: (await cursorPosition()).line,
      forced: true,
    });
  }

  async function clickTagA(_uri: Uri, href: string) {
    href = decodeURIComponent(href);
    href = href
      .replace(/^vscode\-resource:\/\//, '')
      .replace(/^vscode\-webview\-resource:\/\/(.+?)\//, '')
      .replace(/^file\/\/\//, 'file:///')
      .replace(/^https?:\/\/(.+?)\.vscode-webview-test.com\/vscode-resource\/file\/+/, 'file:///')
      .replace(/^https?:\/\/file(.+?)\.vscode-webview\.net\/+/, 'file:///');
    if (['.pdf', '.xls', '.xlsx', '.doc', '.ppt', '.docx', '.pptx'].indexOf(path.extname(href)) >= 0) {
      utility.openFile(href);
    } else if (href.match(/^file:\/\/\//)) {
      // openFilePath = href.slice(8) # remove protocol
      let openFilePath = utility.addFileProtocol(href.replace(/(\s*)[\#\?](.+)$/, '')); // remove #anchor and ?params...
      openFilePath = decodeURI(openFilePath);
      await openVsplit(Uri.parse(openFilePath));
    } else {
      utility.openFile(href);
    }
  }

  async function clickTaskListCheckbox(uri: string, dataLine: string) {
    const doc = workspace.getDocument(uri);
    if (!doc || !isMarkdownFile(doc.textDocument)) {
      return;
    }

    const dataLineNum = parseInt(dataLine, 10);
    let line = doc.getline(dataLineNum);
    if (line.match(/\[ \]/)) {
      line = line.replace('[ ]', '[x]');
    } else {
      line = line.replace(/\[[xX]\]/, '[ ]');
    }
    await doc.applyEdits([
      TextEdit.replace(Range.create(Position.create(dataLineNum, 0), Position.create(dataLineNum, line.length)), line),
    ]);
  }

  function setPreviewTheme(_uri: string, theme: string) {
    const config = workspace.getConfiguration('markdown-preview-enhanced');
    config.update('previewTheme', theme, true);
  }

  context.subscriptions.push(
    workspace.onDidSaveTextDocument(
      logger.asyncCatch((document) => {
        if (isMarkdownFile(document)) {
          contentProvider.updateMarkdown(Uri.parse(document.uri), true);
        }
      }),
    ),
    workspace.onDidChangeTextDocument(
      logger.asyncCatch((event) => {
        const doc = workspace.getDocument(event.textDocument.uri);
        if (doc && isMarkdownFile(doc.textDocument)) {
          contentProvider.update(Uri.parse(doc.uri));
        }
      }),
    ),
    workspace.onDidChangeConfiguration(
      logger.asyncCatch(() => {
        contentProvider.updateConfiguration();
      }),
    ),
    events.on(
      'CursorMoved',
      logger.asyncCatch(async (bufnr) => {
        const doc = workspace.getDocument(bufnr);
        if (doc && isMarkdownFile(doc.textDocument)) {
          if (Date.now() < editorScrollDelay) {
            return;
          }
          const sourceUri = Uri.parse(doc.uri);
          const win = await workspace.nvim.window;
          const height = await win.height;
          if (!height) {
            return undefined;
          }

          const [line] = await win.cursor;
          contentProvider.previewPostMessage(sourceUri, {
            command: 'changeTextEditorSelection',
            line,
          });
        }
      }),
    ),
    /**
     * Open preview automatically if the `automaticallyShowPreviewOfMarkdownBeingEdited` is on.
     * @param textEditor
     */
    events.on(
      'BufEnter',
      logger.asyncCatch(async () => {
        const doc = await workspace.document;
        if (isMarkdownFile(doc.textDocument)) {
          const sourceUri = Uri.parse(doc.uri);
          const config = workspace.getConfiguration('markdown-preview-enhanced');
          const automaticallyShowPreviewOfMarkdownBeingEdited = config.get<boolean>(
            'automaticallyShowPreviewOfMarkdownBeingEdited',
          );
          const isUsingSinglePreview = config.get<boolean>('singlePreview');

          /**
           * Is using single preview and the preview is on.
           * When we switched text ed()tor, update preview to that text editor.
           */
          if (contentProvider.isPreviewOn(sourceUri)) {
            if (isUsingSinglePreview && !contentProvider.previewHasTheSameSingleSourceUri(sourceUri)) {
              await contentProvider.initPreview(sourceUri, doc);
            } else if (!isUsingSinglePreview) {
              const previewPanel = contentProvider.getPreview(sourceUri);
              if (previewPanel) {
                previewPanel.reveal({ openURL: false });
              }
            }
          } else if (automaticallyShowPreviewOfMarkdownBeingEdited) {
            await openPreview(sourceUri);
          }
        }
      }),
    ),
  );

  /*
  context.subscriptions.push(workspace.onDidOpenTextDocument((textDocument)=> {
    // console.log('onDidOpenTextDocument', textDocument.uri)
  }))
  */

  /*
  context.subscriptions.push(window.onDidChangeVisibleTextEditors(textEditors=> {
    // console.log('onDidChangeonDidChangeVisibleTextEditors ', textEditors)
  }))
  */

  const registerCommand = (cmd: string, impl: (...args: any[]) => void) =>
    commands.registerCommand(cmd, logger.asyncCatch(impl));

  context.subscriptions.push(
    registerCommand('markdown-preview-enhanced.openPreview', openPreview),
    registerCommand('markdown-preview-enhanced.toggleScrollSync', toggleScrollSync),
    registerCommand('markdown-preview-enhanced.toggleLiveUpdate', toggleLiveUpdate),
    registerCommand('markdown-preview-enhanced.toggleBreakOnSingleNewLine', toggleBreakOnSingleNewLine),
    registerCommand('markdown-preview-enhanced.openImageHelper', openImageHelper),
    registerCommand('markdown-preview-enhanced.runAllCodeChunks', runAllCodeChunksCommand),
    registerCommand('markdown-preview-enhanced.runCodeChunk', runCodeChunkCommand),
    registerCommand('markdown-preview-enhanced.syncPreview', syncPreview),
    registerCommand('markdown-preview-enhanced.customizeCss', customizeCSS),
    registerCommand('markdown-preview-enhanced.openMermaidConfig', openMermaidConfig),
    registerCommand('markdown-preview-enhanced.openMathJaxConfig', openMathJaxConfig),
    registerCommand('markdown-preview-enhanced.openKaTeXConfig', openKaTeXConfig),
    registerCommand('markdown-preview-enhanced.extendParser', extendParser),
    registerCommand('markdown-preview-enhanced.showUploadedImages', showUploadedImages),
    registerCommand('markdown-preview-enhanced.insertNewSlide', insertNewSlide),
    registerCommand('markdown-preview-enhanced.insertTable', insertTable),
    registerCommand('markdown-preview-enhanced.insertPagebreak', insertPagebreak),
    registerCommand('markdown-preview-enhanced.createTOC', createTOC),
    registerCommand('_mume.revealLine', revealLine),
    registerCommand('_mume.insertImageUrl', insertImageUrl),
    registerCommand('_mume.pasteImageFile', pasteImageFile),
    registerCommand('_mume.uploadImageFile', uploadImageFile),
    registerCommand('_mume.refreshPreview', refreshPreview),
    registerCommand('_mume.openInBrowser', openInBrowser),
    registerCommand('_mume.htmlExport', htmlExport),
    registerCommand('_mume.chromeExport', chromeExport),
    registerCommand('_mume.princeExport', princeExport),
    registerCommand('_mume.eBookExport', eBookExport),
    registerCommand('_mume.pandocExport', pandocExport),
    registerCommand('_mume.markdownExport', markdownExport),
    registerCommand('_mume.webviewFinishLoading', webviewFinishLoading),
    // registerCommand('_mume.cacheSVG', cacheSVG),
    registerCommand('_mume.cacheCodeChunkResult', cacheCodeChunkResult),
    registerCommand('_mume.runCodeChunk', runCodeChunk),
    registerCommand('_mume.runAllCodeChunks', runAllCodeChunks),
    registerCommand('_mume.clickTagA', clickTagA),
    registerCommand('_mume.clickTaskListCheckbox', clickTaskListCheckbox),
    registerCommand('_mume.showUploadedImageHistory', showUploadedImages),
    registerCommand('_mume.setPreviewTheme', setPreviewTheme),
  );
}

async function revealLine(uri: string, line: number) {
  const doc = workspace.getDocument(uri);
  if (doc && isMarkdownFile(doc.textDocument)) {
    const sourceLine = Math.min(Math.floor(line), doc.lineCount - 1);
    const fraction = line - sourceLine;
    const text = doc.getline(sourceLine);
    const start = Math.floor(fraction * text.length);
    const win = await workspace.nvim.window;
    editorScrollDelay = Date.now() + 500;
    await win.setCursor([sourceLine + 1, start]);
    editorScrollDelay = Date.now() + 500;
  }
}

// type WinsaveviewResult = {
//   /** cursor line number */
//   lnum: number;
//   /** cursor column (Note: the first column zero, as opposed to what getpos() returns) */
//   col: number;
//   /** cursor column offset for 'virtualedit' */
//   coladd: number;
//   /** column for vertical movement */
//   curswant: number;
//   /** first line in the window */
//   topline: number;
//   /** filler lines, only in diff mode */
//   topfill: number;
//   /** first column displayed; only used when 'wrap' is off                         */
//   leftcol: number;
//   /** columns skipped */
//   skipcol: number;
// };
//
// async function getWinsaveview(): Promise<WinsaveviewResult> {
//   return workspace.nvim.call('winsaveview');
// }

// this method is called when your extension is deactivated
export function deactivate() {
  //
}
