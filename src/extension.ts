import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import ignore from 'ignore';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'promptgen.sidebar',
      new PromptGeneratorView(context)
    )
  );
}

export function deactivate() {}

class PromptGeneratorView implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveWebviewView(webviewView: vscode.WebviewView) {
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
      ]
    };

    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const files = root ? await getWorkspaceFiles(root) : [];

    const htmlPath = path.join(this.context.extensionPath, 'media', 'webview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const nonce = getNonce();
    html = html
      .replace(/%NONCE%/g, nonce)
      .replace(/%FILELIST%/g, JSON.stringify(files));
    webview.html = html;

    webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'generate') {
        let combined = msg.customText + '\n\n';
        for (const f of msg.files) {
          const fileUri = vscode.Uri.file(path.join(root!, f));
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(bytes).toString('utf8');
          combined += `--- ${f} ---\n${text}\n\n`;
        }
        webview.postMessage({ command: 'result', payload: combined });
      } else if (msg.command === 'copy') {
        await vscode.env.clipboard.writeText(msg.payload);
        vscode.window.showInformationMessage('Скопировано в буфер обмена!');
      }
    });
  }
}

/**
 * Рекурсивно собирает все файлы в workspace, учитывая все .gitignore
 */
async function getWorkspaceFiles(root: string): Promise<string[]> {
  // Находим все .gitignore в проекте
  const gitignoreUris = await vscode.workspace.findFiles('**/.gitignore');
  // Карта: относительный путь директории => объект ignore
  const gitMap: Record<string, ignore.Ignore> = {};
  for (const uri of gitignoreUris) {
    const dirFs = path.dirname(uri.fsPath);
    const relDir = path.relative(root, dirFs).split(path.sep).join('/') || '.';
    const content = fs.readFileSync(uri.fsPath, 'utf8');
    gitMap[relDir] = ignore().add(content);
  }

  // Ищем все файлы, исключая node_modules и .git
  const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git}/**');

  const relPaths = uris.map(u => path.relative(root, u.fsPath).split(path.sep).join('/'));

  return relPaths.filter(rel => {
    // Проверяем каждый .gitignore в цепочке родительских директорий
    const segments = rel.split('/');
    // Начнём с самого вложенного каталога и будем подниматься вверх
    for (let i = segments.length; i >= 0; i--) {
      const dir = i > 0 ? segments.slice(0, i).join('/') : '.';
      const ig = gitMap[dir];
      if (ig) {
        // Относительный путь к файлу от .gitignore директории
        const subPath = i > 0 ? segments.slice(i).join('/') : rel;
        if (subPath && ig.ignores(subPath)) {
          return false; // файл игнорируется
        }
      }
    }
    return true;
  });
}

function getNonce(): string {
  return [...Array(16)]
    .map(() => Math.random().toString(36).replace(/[^a-z0-9]/g, ''))
    .join('');
}
