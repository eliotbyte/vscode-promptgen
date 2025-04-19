import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import ignore from 'ignore';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'promptgen.sidebar',
      new PromptGeneratorView(context),
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
  );
}

export function deactivate() {}

class PromptGeneratorView implements vscode.WebviewViewProvider {
  private watcher?: vscode.FileSystemWatcher;

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
    let filesList = root ? await getWorkspaceFiles(root) : [];
    let tree = buildTree(filesList);

    // restore last UI state
    const persisted = this.context.workspaceState.get<{
      files: string[]; addStructure: boolean; rules: string; task: string;
    }>('promptgenState') || {
      files: [], addStructure: false, rules: '', task: ''
    };

    // inject HTML
    const htmlPath = path.join(this.context.extensionPath, 'media', 'webview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const nonce = getNonce();
    html = html
      .replace(/%NONCE%/g, nonce)
      .replace(/%FILETREE%/g, JSON.stringify(tree));
    webview.html = html;

    // FileSystemWatcher для автоматического обновления
    if (root) {
      this.watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
      this.context.subscriptions.push(this.watcher);
      const refresh = async () => {
        const updated = await getWorkspaceFiles(root);
        const newTree = buildTree(updated);
        webview.postMessage({ command: 'updateTree', tree: newTree });
      };
      this.watcher.onDidCreate(refresh);
      this.watcher.onDidDelete(refresh);
      this.watcher.onDidChange(refresh);
    }

    // сообщения из Webview
    webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'state') {
        await this.context.workspaceState.update('promptgenState', msg.state);
      }
      else if (msg.command === 'generate') {
        const { files, addStructure, rules, task } = msg;
        let result = '';

        if (addStructure) {
          const all = flattenPaths(tree);
          result += '<filetree>\n```yaml\nfiles:\n';
          all.forEach(f => result += `  - ${f}\n`);
          result += '```\n</filetree>\n\n';
        }

        if (files.length) {
          result += '<code>\n';
          for (const f of files) {
            const uri = vscode.Uri.file(path.join(root!, f));
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8');
            const ext = path.extname(f).slice(1);
            result += `\`\`\`${ext} ${f}\n${text}\n\`\`\`\n\n`;
          }
          result += '</code>\n\n';
        }

        if (rules.trim()) {
          result += `<rules>\n${rules}\n</rules>\n\n`;
        }
        if (task.trim()) {
          result += `<task>\n${task}\n</task>\n\n`;
        }

        webview.postMessage({ command: 'result', payload: result });
      }
      else if (msg.command === 'copy') {
        await vscode.env.clipboard.writeText(msg.payload);
        vscode.window.showInformationMessage('Copied to clipboard!');
      }
    });
  }
}

// вспомогалки
function flattenPaths(nodes: any[]): string[] {
  let res: string[] = [];
  for (const n of nodes) {
    if (n.type === 'file') res.push(n.fullPath);
    else if (n.type === 'dir') res.push(...flattenPaths(n.children));
  }
  return res;
}

async function getWorkspaceFiles(root: string): Promise<string[]> {
  const gitignoreUris = await vscode.workspace.findFiles('**/.gitignore');
  const gitMap: Record<string, any> = {};
  for (const uri of gitignoreUris) {
    const dirFs = path.dirname(uri.fsPath);
    const relDir = path.relative(root, dirFs).split(path.sep).join('/') || '.';
    const content = fs.readFileSync(uri.fsPath, 'utf8');
    gitMap[relDir] = ignore().add(content);
  }
  const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git}/**');
  const rels = uris.map(u => path.relative(root, u.fsPath).split(path.sep).join('/'));
  return rels.filter(rel => {
    const seg = rel.split('/');
    for (let i = seg.length; i >= 0; i--) {
      const dir = i > 0 ? seg.slice(0, i).join('/') : '.';
      const ig = gitMap[dir];
      if (ig) {
        const sub = i > 0 ? seg.slice(i).join('/') : rel;
        if (sub && ig.ignores(sub)) return false;
      }
    }
    return true;
  });
}

function buildTree(paths: string[]): any[] {
  const root: any = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const rel = parts.slice(0, i + 1).join('/');
      if (!node[name]) {
        node[name] = { __name: name, __type: isFile ? 'file' : 'dir', __path: rel, __children: {} };
      }
      node = node[name].__children;
    }
  }
  function toArray(obj: any): any[] {
    return Object.values(obj)
      .map((e: any) => {
        const { __name, __type, __path, __children } = e;
        const n: any = { name: __name, type: __type, fullPath: __path };
        if (__type === 'dir') {
          n.children = toArray(__children).sort((a: any, b: any) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        }
        return n;
      })
      .sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }
  return toArray(root);
}

function getNonce(): string {
  return [...Array(16)]
    .map(() => Math.random().toString(36).replace(/[^a-z0-9]/g, ''))
    .join('');
}
