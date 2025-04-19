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

    // Получаем корень первого workspace
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const files = root ? await getWorkspaceFiles(root) : [];

    // Загружаем HTML-шаблон и подставляем nonce + массив файлов
    const htmlPath = path.join(this.context.extensionPath, 'media', 'webview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const nonce = getNonce();
    html = html
      .replace(/%NONCE%/g, nonce)
      .replace(/%FILELIST%/g, JSON.stringify(files));
    webview.html = html;

    // Приём и обработка сообщений из Webview
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

async function getWorkspaceFiles(root: string): Promise<string[]> {
  // Считываем .gitignore (если есть)
  const gitignorePath = path.join(root, '.gitignore');
  let ig = ignore();
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    ig = ignore().add(content);
  }

  // Ищем все файлы, исключая node_modules и .git
  const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git}/**');

  return uris
    .map(uri => {
      // Относительный путь и нормализация в UNIX‑стиль
      return path.relative(root, uri.fsPath).split(path.sep).join('/');
    })
    .filter(rel => !ig.ignores(rel));
}

function getNonce(): string {
  return [...Array(16)]
    .map(() => Math.random().toString(36).replace(/[^a-z0-9]/g, ''))
    .join('');
}
