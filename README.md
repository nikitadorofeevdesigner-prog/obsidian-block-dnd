# Block Drag & Drop

A plugin for Obsidian that enables Notion-style drag and drop functionality for text blocks within your notes.

## Features

- 🖱️ **Drag and Drop Blocks** - Move paragraphs, headings, lists, and code blocks by dragging
- 👆 **Notion-style Handles** - Hover over any line to reveal the drag handle
- 📱 **Mobile Support** - Full touch support for mobile devices with long-press to drag
- ⚡ **Smooth Animations** - Polished visual feedback during drag operations
- 🎯 **Precise Positioning** - Visual drop indicator shows exactly where your block will land

## Installation

### From Obsidian Community Plugins

1. Open Settings in Obsidian
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "Block Drag & Drop"
4. Click Install, then Enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/nikitadorofeevdesigner-prog/obsidian-block-dnd/releases)
2. Create a folder named `block-dnd` in your vault's `.obsidian/plugins/` directory
3. Place the downloaded files in the `block-dnd` folder
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

## Usage

### Desktop

1. Open any note in edit mode
2. Hover over any line to reveal the drag handle (⋮⋮) on the left
3. Click and drag the handle to move the block
4. Drop it at the desired position

### Mobile

1. Long-press on any line to select it
2. Drag your finger to move the block
3. Release to drop it at the new position

## Settings

- **Show handle on hover** - Toggle whether drag handles appear on hover (default: enabled)

## How It Works

The plugin creates draggable handles for each line in your note. When you drag a block:
- The plugin identifies the logical block boundaries (paragraphs, lists, headings, etc.)
- A visual indicator shows where the block will be inserted
- The text is moved while preserving formatting and structure

## Compatibility

- Requires Obsidian v1.0.0 or higher
- Works on desktop (Windows, macOS, Linux) and mobile (iOS, Android)
- Compatible with most themes and other plugins

## Support

If you encounter any issues or have feature requests:
- [Open an issue](https://github.com/YOUR_USERNAME/obsidian-block-dnd/issues)
- Describe your setup (OS, Obsidian version, mobile/desktop)
- Include steps to reproduce if reporting a bug

## Development

Want to contribute? PRs are welcome!

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/obsidian-block-dnd.git

# Install dependencies (if you add any)
npm install

# Make your changes to main.js and styles.css
# Test in your vault's plugins folder
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

Created by Nikita

Inspired by Notion's intuitive block manipulation interface.
