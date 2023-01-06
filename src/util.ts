import { HelperLogger } from 'coc-helper';
import { WebviewAPI } from 'coc-webview';
import { Extension, extensions, window } from 'coc.nvim';

export const logger = new HelperLogger('markdown-preview-enhanced');

let webviewExt: Extension<WebviewAPI> | undefined;

export const getWebviewAPI = () => {
  if (!webviewExt) {
    webviewExt = extensions.all.find((ext) => ext.id === 'coc-webview') as
      | Extension<WebviewAPI>
      | undefined;
  }
  if (!webviewExt) {
    const prompt = 'Please install the coc-webview extension';
    void window.showErrorMessage(prompt);
    throw new Error(prompt);
  }
  return webviewExt.exports;
};
