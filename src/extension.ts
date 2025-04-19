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
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
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
    const filesList = root ? await getWorkspaceFiles(root) : [];
    const tree = buildTree(filesList);

    // Retrieve persisted state
    const persisted = this.context.workspaceState.get<{
      files: string[];
      addStructure: boolean;
      rules: string;
      task: string;
    }>('promptgenState') || {
      files: [],
      addStructure: false,
      rules: '',
      task: ''
    };

    const htmlPath = path.join(this.context.extensionPath, 'media', 'webview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const nonce = getNonce();
    html = html
      .replace(/%NONCE%/g, nonce)
      .replace(/%FILETREE%/g, JSON.stringify(tree));
    webview.html = html;

    webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'state') {
        // Save updated UI state
        await this.context.workspaceState.update('promptgenState', msg.state);
      } else if (msg.command === 'generate') {
        const { files, addStructure, rules, task } = msg;
        let result = '';

        // 1. Project structure as YAML manifest
        if (addStructure) {
          const allFiles = flattenPaths(tree);
          result += '<filetree>\n';
          result += '```yaml\n';
          result += 'files:\n';
          allFiles.forEach(f => {
            result += `  - ${f}\n`;
          });
          result += '```\n';
          result += '</filetree>\n\n';
        }

        // 2. Code of selected files
        if (files.length) {
          result += '<code>\n';
          for (const f of files) {
            const fileUri = vscode.Uri.file(path.join(root!, f));
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(bytes).toString('utf8');
            const ext = path.extname(f).slice(1);
            result += `\`\`\`${ext} ${f}\n${text}\n\`\`\`\n\n`;
          }
          result += '</code>\n\n';
        }

        // 3. Rules section
        if (rules && rules.trim()) {
          result += `<rules>\n${rules}\n</rules>\n\n`;
        }

        // 4. Task section
        if (task && task.trim()) {
          result += `<task>\n${task}\n</task>\n\n`;
        }

        webview.postMessage({ command: 'result', payload: result });
      } else if (msg.command === 'copy') {
        await vscode.env.clipboard.writeText(msg.payload);
        vscode.window.showInformationMessage('Copied to clipboard!');
      }
    });
  }
}

/**
 * Flattens the nested tree into a list of file paths.
 */
function flattenPaths(nodes: any[]): string[] {
  let result: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push(node.fullPath);
    } else if (node.type === 'dir' && node.children) {
      result.push(...flattenPaths(node.children));
    }
  }
  return result;
}

/**
 * Scans all .gitignore files, aggregates patterns, and filters workspace files.
 */
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
  const relPaths = uris.map(u => path.relative(root, u.fsPath).split(path.sep).join('/'));

  return relPaths.filter(rel => {
    const segments = rel.split('/');
    for (let i = segments.length; i >= 0; i--) {
      const dir = i > 0 ? segments.slice(0, i).join('/') : '.';
      const ig = gitMap[dir];
      if (ig) {
        const sub = i > 0 ? segments.slice(i).join('/') : rel;
        if (sub && ig.ignores(sub)) {
          return false;
        }
      }
    }
    return true;
  });
}

/**
 * Transforms a flat list of file paths into a nested tree structure.
 */
function buildTree(paths: string[]): any[] {
  const root: any = {};

  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const relPath = parts.slice(0, i + 1).join('/');

      if (!node[name]) {
        node[name] = {
          __name: name,
          __type: isFile ? 'file' : 'dir',
          __path: relPath,
          __children: {}
        };
      }
      node = node[name].__children;
    }
  }

  function toArray(obj: any): any[] {
    return Object.values(obj)
      .map((entry: any) => {
        const { __name, __type, __path, __children } = entry;
        const node: any = {
          name: __name,
          type: __type,
          fullPath: __path
        };

        if (__type === 'dir') {
          node.children = toArray(__children)
            .sort((a: any, b: any) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
        }

        return node;
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
