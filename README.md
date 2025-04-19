## promptgen

`promptgen` — VS Code extension for generating and copying code snippets and YAML manifests directly from your workspace.

## Features

- **Interactive file tree**: Browse and select files in your workspace via a collapsible directory tree.
- **Customizable options**: Toggle project structure export, define rules, and describe tasks directly in the sidebar.
- **Persistent state**: All selections and inputs are remembered across sessions via VS Code `workspaceState`.
- **Live updates**: Automatically refreshes file list on workspace changes using `FileSystemWatcher`.

## Requirements

- [Node.js](https://nodejs.org/) (>=12.x)
- [Visual Studio Code](https://code.visualstudio.com/) (>=1.50)
- [`vsce`](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) CLI to package the extension (install via `npm install -g vsce`) ([code.visualstudio.com](https://code.visualstudio.com/api/working-with-extensions/publishing-extension?utm_source=chatgpt.com))

## Installation

### 1. Build and package

1. Clone or download this repository.
2. Install dependencies:

```bash
npm install
```

3. Package the extension as a `.vsix`:

```bash
vsce package
```

This will create a file like `promptgen-1.0.0.vsix` in the project root ([code.visualstudio.com](https://code.visualstudio.com/api/working-with-extensions/publishing-extension?utm_source=chatgpt.com)).

### 2. Install in VS Code

#### Via the Extensions view

1. Open the **Extensions** sidebar (⇧⌘X on macOS, Ctrl+Shift+X on Windows/Linux).
2. Click the **...** menu at the top and select **Install from VSIX...**.
3. Choose the generated `promptgen-*.vsix` file and click **Install** ([code.visualstudio.com](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace?utm_source=chatgpt.com)).

#### Via the command line

You can also install the packaged extension using the VS Code CLI:

```bash
code --install-extension promptgen-1.0.0.vsix
```

## Extension Settings

This extension does not contribute any new VS Code settings.

## Known Issues

- If you move or rename files externally, the extension refreshes automatically; however, unsaved selections pointing to removed files will be cleared.

## Release Notes

### 1.0.0

- Initial release with full file-tree browsing, state persistence, and live updates.

## Contributing

Contributions are welcome! Please open issues or pull requests on the [GitHub repository].

## License

MIT © Eliot Byte