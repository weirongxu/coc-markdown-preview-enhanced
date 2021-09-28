import * as mume from '@shd101wyy/mume';
import { MarkdownEngine } from '@shd101wyy/mume';
import { useExternalAddFileProtocolFunction } from '@shd101wyy/mume/out/src/utility';
import type { WebviewOptions, WebviewPanel } from 'coc-webview';
import {
  commands,
  Document,
  ExtensionContext,
  Position,
  Range,
  TextDocument,
  TextEdit,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from 'coc.nvim';
import path from 'path';
import { MarkdownPreviewEnhancedConfig } from './config';
import { getWebviewAPI, logger } from './util';

// http://www.typescriptlang.org/play/
// https://github.com/Microsoft/vscode/blob/master/extensions/markdown/media/main.js
// https://github.com/Microsoft/vscode/tree/master/extensions/markdown/src
// https://github.com/tomoki1207/gfm-preview/blob/master/src/gfmProvider.ts
// https://github.com/cbreeden/vscode-markdownit
export class MarkdownPreviewEnhancedView {
  private waiting = false;

  /**
   * The key is markdown file fsPath
   * value is MarkdownEngine
   */
  private engineMaps: { [key: string]: MarkdownEngine } = {};

  /**
   * The key is markdown file fspath
   * value is Preview (Webview) object
   */
  private previewMaps: { [key: string]: WebviewPanel } = {};

  private preview2EditorMap: Map<WebviewPanel, Document> = new Map();

  private singlePreviewPanel: WebviewPanel | null = null;
  private singlePreviewPanelSourceUriTarget: Uri | null = null;

  /**
   * The key is markdown file fsPath
   * value is JSAndCssFiles
   */
  private jsAndCssFilesMaps: { [key: string]: string[] } = {};

  private config: MarkdownPreviewEnhancedConfig;

  public constructor(private context: ExtensionContext) {
    this.config = MarkdownPreviewEnhancedConfig.getCurrentConfig();

    mume
      .init(this.config.configPath) // init markdown-preview-enhanced
      .then(async () => {
        mume.onDidChangeConfigFile(this.refreshAllPreviews.bind(this));
        MarkdownEngine.onModifySource(this.modifySource.bind(this));
        useExternalAddFileProtocolFunction((filePath: string, preview: WebviewPanel) => {
          if (preview) {
            return preview.webview
              .asWebviewUri(Uri.file(filePath))
              .toString(true)
              .replace(/%3F/gi, '?')
              .replace(/%23/g, '#');
          } else {
            if (!filePath.startsWith('file://')) {
              filePath = 'file:///' + filePath;
            }
            filePath = filePath.replace(/^file\:\/+/, 'file:///');
            return filePath;
          }
        });
      })
      .catch((error) => {
        void window.showErrorMessage(error.toString());
      });
  }

  private refreshAllPreviews() {
    // clear caches
    for (const key in this.engineMaps) {
      if (this.engineMaps.hasOwnProperty(key)) {
        const engine = this.engineMaps[key];
        if (engine) {
          // No need to resetConfig.
          // Otherwiser when user change settings like `previewTheme`, the preview won't change immediately.
          // engine.resetConfig();
          engine.clearCaches();
        }
      }
    }

    // refresh iframes
    if (useSinglePreview()) {
      if (!this.singlePreviewPanelSourceUriTarget) {
        return;
      }
      this.refreshPreviewPanel(this.singlePreviewPanelSourceUriTarget);
    } else {
      for (const key in this.previewMaps) {
        if (this.previewMaps.hasOwnProperty(key)) {
          this.refreshPreviewPanel(Uri.file(key));
        }
      }
    }
  }

  /**
   * modify markdown source, append `result` after corresponding code chunk.
   * @param codeChunkData
   * @param result
   * @param filePath
   */
  private async modifySource(codeChunkData: mume.CodeChunkData, result: string, filePath: string): Promise<string> {
    async function insertResult(i: number, doc: Document) {
      const lineCount = doc.lineCount;
      let start = 0;
      // find <!-- code_chunk_output -->
      for (let j = i + 1; j < i + 6 && j < lineCount; j++) {
        if (doc.getline(j).startsWith('<!-- code_chunk_output -->')) {
          start = j;
          break;
        }
      }
      if (start) {
        // found
        // TODO: modify exited output
        let end = start + 1;
        while (end < lineCount) {
          if (doc.getline(end).startsWith('<!-- /code_chunk_output -->')) {
            break;
          }
          end += 1;
        }

        // if output not changed, then no need to modify editor buffer
        let r = '';
        for (let i2 = start + 2; i2 < end - 1; i2++) {
          r += doc.getline(i2) + '\n';
        }
        if (r === result + '\n') {
          return '';
        } // no need to modify output

        await doc.applyEdits([
          TextEdit.replace(Range.create(Position.create(start + 2, 0), Position.create(end - 1, 0)), result + '\n'),
        ]);
        return '';
      } else {
        await doc.applyEdits([
          TextEdit.insert(
            Position.create(i + 1, 0),
            `\n<!-- code_chunk_output -->\n\n${result}\n\n<!-- /code_chunk_output -->\n`,
          ),
        ]);
        return '';
      }
    }

    const doc = await workspace.document;
    if (this.formatPathIfNecessary(doc.uri) === filePath) {
      let codeChunkOffset = 0;
      const targetCodeChunkOffset = codeChunkData.normalizedInfo.attributes['code_chunk_offset'];

      const lineCount = doc.lineCount;
      for (let i2 = 0; i2 < lineCount; i2++) {
        const line = doc.getline(i2);
        if (line.match(/^```(.+)\"?cmd\"?\s*[=\s}]/)) {
          if (codeChunkOffset === targetCodeChunkOffset) {
            i2 = i2 + 1;
            while (i2 < lineCount) {
              if (doc.getline(i2).match(/^\`\`\`\s*/)) {
                break;
              }
              i2 += 1;
            }
            return insertResult(i2, doc);
          } else {
            codeChunkOffset++;
          }
        } else if (line.match(/\@import\s+(.+)\"?cmd\"?\s*[=\s}]/)) {
          if (codeChunkOffset === targetCodeChunkOffset) {
            return insertResult(i2, doc);
          } else {
            codeChunkOffset++;
          }
        }
      }
    }
    return '';
  }

  /**
   * return markdown engine of sourceUri
   * @param sourceUri
   */
  public getEngine(sourceUri: Uri): MarkdownEngine {
    return this.engineMaps[sourceUri.fsPath];
  }

  /**
   * return markdown preview of sourceUri
   * @param sourceUri
   */
  public getPreview(sourceUri: Uri): WebviewPanel | null {
    if (useSinglePreview()) {
      // assert(this.singlePreviewPanel, 'singlePreviewPanel must be initialized');
      return this.singlePreviewPanel;
    } else {
      return this.previewMaps[sourceUri.fsPath];
    }
  }

  /**
   * check if the markdown preview is on for the textEditor
   * @param textEditor
   */
  public isPreviewOn(sourceUri: Uri) {
    if (useSinglePreview()) {
      return !!this.singlePreviewPanel;
    } else {
      return !!this.getPreview(sourceUri);
    }
  }

  public destroyPreview(sourceUri: Uri) {
    if (useSinglePreview()) {
      this.singlePreviewPanel = null;
      this.singlePreviewPanelSourceUriTarget = null;
      this.preview2EditorMap = new Map();
      this.previewMaps = {};
    } else {
      const previewPanel = this.getPreview(sourceUri);
      if (previewPanel) {
        this.preview2EditorMap.delete(previewPanel);
        delete this.previewMaps[sourceUri.fsPath];
      }
    }
  }

  /**
   * remove engine from this.engineMaps
   * @param sourceUri
   */
  public destroyEngine(sourceUri: Uri) {
    if (useSinglePreview()) {
      return (this.engineMaps = {});
    }
    const engine = this.getEngine(sourceUri);
    if (engine) {
      delete this.engineMaps[sourceUri.fsPath]; // destroy engine
    }
  }

  /**
   * Format pathString if it is on Windows. Convert `c:\` like string to `C:\`
   * @param pathString
   */
  private formatPathIfNecessary(pathString: string) {
    if (process.platform === 'win32') {
      pathString = pathString.replace(/^([a-zA-Z])\:\\/, (_, $1) => `${$1.toUpperCase()}:\\`);
    }
    return pathString;
  }

  private getProjectDirectoryPath(sourceUri: Uri, workspaceFolders: readonly WorkspaceFolder[] = []) {
    const possibleWorkspaceFolders = workspaceFolders.filter((workspaceFolder) => {
      return path.dirname(sourceUri.path.toUpperCase()).indexOf(workspaceFolder.uri.toUpperCase()) >= 0;
    });

    let projectDirectoryPath: string;
    if (possibleWorkspaceFolders.length) {
      // We pick the workspaceUri that has the longest path
      const workspaceFolder = possibleWorkspaceFolders.sort((x, y) => y.uri.length - x.uri.length)[0];
      projectDirectoryPath = workspaceFolder.uri;
    } else {
      projectDirectoryPath = '';
    }

    return this.formatPathIfNecessary(projectDirectoryPath);
  }

  private getFilePath(sourceUri: Uri) {
    return this.formatPathIfNecessary(sourceUri.fsPath);
  }

  /**
   * Initialize MarkdownEngine for this markdown file
   */
  public initMarkdownEngine(sourceUri: Uri): MarkdownEngine {
    let engine = this.getEngine(sourceUri);
    if (!engine) {
      engine = new MarkdownEngine({
        filePath: this.getFilePath(sourceUri),
        projectDirectoryPath: this.getProjectDirectoryPath(sourceUri, workspace.workspaceFolders),
        config: this.config,
      });
      this.engineMaps[sourceUri.fsPath] = engine;
      this.jsAndCssFilesMaps[sourceUri.fsPath] = [];
    }
    return engine;
  }

  private getWebviewOptions(): WebviewOptions {
    return {
      enableScripts: true, // TODO: This might be set by enableScriptExecution config. But for now we just enable it.
    };
  }

  public async initPreview(sourceUri: Uri, doc: Document, openURL: boolean) {
    const isUsingSinglePreview = useSinglePreview();
    let previewPanel: WebviewPanel;
    if (isUsingSinglePreview && this.singlePreviewPanel) {
      if (!this.singlePreviewPanelSourceUriTarget) {
        return;
      }
      const oldResourceRoot =
        this.getProjectDirectoryPath(this.singlePreviewPanelSourceUriTarget, workspace.workspaceFolders) ||
        path.dirname(this.singlePreviewPanelSourceUriTarget.fsPath);
      const newResourceRoot =
        this.getProjectDirectoryPath(sourceUri, workspace.workspaceFolders) || path.dirname(sourceUri.fsPath);
      if (oldResourceRoot !== newResourceRoot) {
        this.singlePreviewPanel.webview.options = this.getWebviewOptions();
      }
      previewPanel = this.singlePreviewPanel;
      this.singlePreviewPanelSourceUriTarget = sourceUri;
    } else if (this.previewMaps[sourceUri.fsPath]) {
      previewPanel = this.previewMaps[sourceUri.fsPath];
    } else {
      previewPanel = await getWebviewAPI().createWebviewPanel(
        'markdown-preview-enhanced',
        `Preview ${path.basename(sourceUri.fsPath)}`,
        {
          openURL,
          routeName: 'markdown-preview-enhanced',
        },
        this.getWebviewOptions(),
      );
      previewPanel.iconPath = Uri.file(path.join(this.context.extensionPath, 'media', 'preview.svg'));

      // register previewPanel message events
      previewPanel.webview.onDidReceiveMessage(
        (message) => {
          commands.executeCommand(`_mume.${message.command}`, ...message.args).catch(logger.error);
        },
        null,
        this.context.subscriptions,
      );

      // unregister previewPanel
      previewPanel.onDidDispose(
        () => {
          this.destroyPreview(sourceUri);
          this.destroyEngine(sourceUri);
        },
        null,
        this.context.subscriptions,
      );

      if (isUsingSinglePreview) {
        this.singlePreviewPanel = previewPanel;
        this.singlePreviewPanelSourceUriTarget = sourceUri;
      }
    }

    // register previewPanel
    this.previewMaps[sourceUri.fsPath] = previewPanel;
    this.preview2EditorMap.set(previewPanel, doc);

    // set title
    previewPanel.title = `Preview ${path.basename(sourceUri.fsPath)}`;

    // init markdown engine
    let initialLine: number | undefined;
    if (doc && doc.uri === sourceUri.fsPath) {
      const cursor = await (await workspace.nvim.window).cursor;
      initialLine = cursor[0] ? cursor[0] - 1 : 0;
    }

    const text = doc.getDocumentContent();
    let engine = this.getEngine(sourceUri);
    if (!engine) {
      engine = this.initMarkdownEngine(sourceUri);
    }

    engine
      .generateHTMLTemplateForPreview({
        inputString: text,
        config: {
          sourceUri: sourceUri.toString(),
          initialLine,
          vscode: true,
        },
        contentSecurityPolicy: '',
        vscodePreviewPanel: previewPanel,
      })
      .then((html) => {
        previewPanel.webview.html = html;
      })
      .catch(logger.error);
  }

  /**
   * Close all previews
   */
  public closeAllPreviews(singlePreview: boolean) {
    if (singlePreview) {
      if (this.singlePreviewPanel) {
        this.singlePreviewPanel.dispose();
      }
    } else {
      const previewPanels: WebviewPanel[] = [];
      for (const key in this.previewMaps) {
        if (this.previewMaps.hasOwnProperty(key)) {
          const previewPanel = this.previewMaps[key];
          if (previewPanel) {
            previewPanels.push(previewPanel);
          }
        }
      }

      previewPanels.forEach((previewPanel) => previewPanel.dispose());
    }

    this.previewMaps = {};
    this.preview2EditorMap = new Map();
    this.engineMaps = {};
    this.singlePreviewPanel = null;
    this.singlePreviewPanelSourceUriTarget = null;
  }

  public previewPostMessage(sourceUri: Uri, message: any) {
    const preview = this.getPreview(sourceUri);
    if (preview) {
      void preview.webview.postMessage(message);
    }
  }

  public previewHasTheSameSingleSourceUri(sourceUri: Uri) {
    if (!this.singlePreviewPanelSourceUriTarget) {
      return false;
    } else {
      return this.singlePreviewPanelSourceUriTarget.fsPath === sourceUri.fsPath;
    }
  }

  public updateMarkdown(sourceUri: Uri, triggeredBySave?: boolean) {
    const engine = this.getEngine(sourceUri);
    if (!engine) {
      return;
    }

    const previewPanel = this.getPreview(sourceUri);
    if (!previewPanel) {
      return;
    }

    // presentation mode
    if (engine.isPreviewInPresentationMode) {
      return this.refreshPreview(sourceUri);
    }

    // not presentation mode
    const doc = workspace.getDocument(sourceUri.fsPath);
    const text = doc.getDocumentContent();
    this.previewPostMessage(sourceUri, {
      command: 'startParsingMarkdown',
    });

    const preview = this.getPreview(sourceUri);

    engine
      .parseMD(text, {
        isForPreview: true,
        useRelativeFilePath: false,
        hideFrontMatter: false,
        triggeredBySave,
        vscodePreviewPanel: preview,
      })
      .then(({ html, tocHTML, JSAndCssFiles, yamlConfig }) => {
        // check JSAndCssFiles
        if (
          JSON.stringify(JSAndCssFiles) !== JSON.stringify(this.jsAndCssFilesMaps[sourceUri.fsPath]) ||
          yamlConfig['isPresentationMode']
        ) {
          this.jsAndCssFilesMaps[sourceUri.fsPath] = JSAndCssFiles;
          // restart iframe
          this.refreshPreview(sourceUri);
        } else {
          this.previewPostMessage(sourceUri, {
            command: 'updateHTML',
            html,
            tocHTML,
            totalLineCount: doc.lineCount,
            sourceUri: sourceUri.toString(),
            id: yamlConfig.id || '',
            class: yamlConfig.class || '',
          });
        }
      })
      .catch(logger.error);
  }

  public refreshPreviewPanel(sourceUri: Uri) {
    this.preview2EditorMap.forEach((doc, previewPanel) => {
      if (previewPanel && doc && isMarkdownFile(doc.textDocument) && doc.uri && doc.uri === sourceUri.fsPath) {
        void this.initPreview(sourceUri, doc, false);
      }
    });
  }

  public refreshPreview(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine.clearCaches();
      // restart iframe
      this.refreshPreviewPanel(sourceUri);
    }
  }

  public openInBrowser(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine.openInBrowser({}).catch((error) => {
        window.showErrorMessage(error.toString()).catch(logger.error);
      });
    }
  }

  public htmlExport(sourceUri: Uri, offline: boolean) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .htmlExport({ offline })
        .then((dest) => {
          void window.showInformationMessage(`File ${path.basename(dest)} was created at path: ${dest}`);
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  public chromeExport(sourceUri: Uri, type: string) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .chromeExport({ fileType: type, openFileAfterGeneration: true })
        .then((dest) => {
          void window.showInformationMessage(`File ${path.basename(dest)} was created at path: ${dest}`);
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  public princeExport(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .princeExport({ openFileAfterGeneration: true })
        .then((dest) => {
          if (dest.endsWith('?print-pdf')) {
            // presentation pdf
            void window.showInformationMessage(
              `Please copy and open the link: { ${dest.replace(/\_/g, '\\_')} } in Chrome then Print as Pdf.`,
            );
          } else {
            void window.showInformationMessage(`File ${path.basename(dest)} was created at path: ${dest}`);
          }
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  public eBookExport(sourceUri: Uri, fileType: string) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .eBookExport({ fileType, runAllCodeChunks: false })
        .then((dest) => {
          void window.showInformationMessage(`eBook ${path.basename(dest)} was created as path: ${dest}`);
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  public pandocExport(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .pandocExport({ openFileAfterGeneration: true })
        .then((dest) => {
          void window.showInformationMessage(`Document ${path.basename(dest)} was created as path: ${dest}`);
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  public markdownExport(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .markdownExport({})
        .then((dest) => {
          void window.showInformationMessage(`Document ${path.basename(dest)} was created as path: ${dest}`);
        })
        .catch((error) => {
          void window.showErrorMessage(error.toString());
        });
    }
  }

  /*
  public cacheSVG(sourceUri: Uri, code:string, svg:string) {
    const engine = this.getEngine(sourceUri)
    if (engine) {
      engine.cacheSVG(code, svg)
    }
  }
  */

  public cacheCodeChunkResult(sourceUri: Uri, id: string, result: string) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine.cacheCodeChunkResult(id, result);
    }
  }

  public runCodeChunk(sourceUri: Uri, codeChunkId: string) {
    const engine = this.getEngine(sourceUri);
    logger.prettyPrint(sourceUri.toString(), codeChunkId);
    if (engine) {
      engine
        .runCodeChunk(codeChunkId)
        .then(() => {
          this.updateMarkdown(sourceUri);
        })
        .catch(logger.error);
    }
  }

  public runAllCodeChunks(sourceUri: Uri) {
    const engine = this.getEngine(sourceUri);
    if (engine) {
      engine
        .runCodeChunks()
        .then(() => {
          this.updateMarkdown(sourceUri);
        })
        .catch(logger.error);
    }
  }

  public update(sourceUri: Uri) {
    if (!this.config.liveUpdate || !this.getPreview(sourceUri)) {
      return;
    }

    if (!this.waiting) {
      this.waiting = true;
      setTimeout(() => {
        this.waiting = false;
        // this._onDidChange.fire(uri);
        this.updateMarkdown(sourceUri);
      }, 300);
    }
  }

  public updateConfiguration() {
    const newConfig = MarkdownPreviewEnhancedConfig.getCurrentConfig();
    if (!this.config.isEqualTo(newConfig)) {
      // if `singlePreview` setting is changed, close all previews.
      if (this.config.singlePreview !== newConfig.singlePreview) {
        this.closeAllPreviews(this.config.singlePreview);
        this.config = newConfig;
      } else {
        this.config = newConfig;
        for (const fsPath in this.engineMaps) {
          if (this.engineMaps.hasOwnProperty(fsPath)) {
            const engine = this.engineMaps[fsPath];
            engine.updateConfiguration(newConfig);
          }
        }

        // update all generated md documents
        this.refreshAllPreviews();
      }
    }
  }

  public openImageHelper(sourceUri: Uri) {
    if (sourceUri.scheme === 'markdown-preview-enhanced') {
      return window.showWarningMessage('Please focus a markdown file.');
    } else if (!this.isPreviewOn(sourceUri)) {
      return window.showWarningMessage('Please open preview first.');
    } else {
      return this.previewPostMessage(sourceUri, {
        command: 'openImageHelper',
      });
    }
  }
}

/**
 * check whehter to use only one preview or not
 */
export function useSinglePreview() {
  const config = workspace.getConfiguration('markdown-preview-enhanced');
  return config.get<boolean>('singlePreview');
}

export function getPreviewUri(uri: Uri) {
  if (uri.scheme === 'markdown-preview-enhanced') {
    return uri;
  }

  let previewUri: Uri;
  if (useSinglePreview()) {
    previewUri = uri.with({
      scheme: 'markdown-preview-enhanced',
      path: 'single-preview.rendered',
    });
  } else {
    previewUri = uri.with({
      scheme: 'markdown-preview-enhanced',
      path: uri.path + '.rendered',
      query: uri.toString(),
    });
  }
  return previewUri;
}

export function isMarkdownFile(document: TextDocument) {
  const uri = Uri.parse(document.uri);
  return document.languageId === 'markdown' && uri.scheme !== 'markdown-preview-enhanced'; // prevent processing of own documents
}
