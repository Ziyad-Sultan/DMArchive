# DMArchive

**Archive your Discord DMs cleanly and easily.**

**DMArchive** is a [BetterDiscord](https://betterdiscord.app) plugin that adds an **Archived** row right above your DMs. Clicking it opens a dedicated archive view with a search bar, back button, message previews, pinning, and seamless compatibility with [DMFolders](https://github.com/Ziyad-Sultan/DMFolders).

<!-- Add a screenshot or GIF here, for example: ![DMArchive preview](screenshots/preview.png) -->

## Features

- **Archived Row**: Adds an **Archived** row right above your DM list (and integrates neatly below your `DMFolders` tab bar if installed).
- **Dedicated Archive View**: Click the row to open a clean separate list complete with a back arrow, chat count, and search bar.
- **Pin to Top**: Pin important archived conversations so they always stay at the top of your archive list.
- **Last Message Previews**: Automatically tracks and displays the latest message preview (including text, attachments, stickers, and links, complete with smart prefixes like "You:" or sender names in group chats).
- **Optional Auto-Mute**: Automatically mutes chats when you archive them and unmutes them when you unarchive them (only affects mutes managed by the plugin).
- **Flexible Mute & Read Options**: Right-click archived chats to mute notifications for custom durations (15 mins, 1 hour, 8 hours, 24 hours, or indefinitely), mark individual or all chats as read, or unarchive them instantly.
- **Press Esc to Go Back**: Instantly return to your normal DM list by pressing `Esc` (clears the search box first if text is entered).
- **DMFolders Integration**: Automatically detects `DMFolders` and adjusts layout styling so both plugins work together flawlessly without overlapping.

## Installation

1. Install [BetterDiscord](https://betterdiscord.app) if you haven't already.
2. Download [`DMArchive.plugin.js`](DMArchive.plugin.js) from this repository.
3. In Discord, go to **Settings → BetterDiscord → Plugins → Open Plugins Folder**, and drop the file there.
4. Enable **DMArchive** in your BetterDiscord plugin list.

## Usage

| I want to… | Do this |
| --- | --- |
| Archive a DM | Right-click any DM → **Archive** |
| Open the archive | Click the **Archived** row above your DMs |
| Pin a chat in the archive | Right-click the chat in the archive → **Pin to top** |
| Search archived chats | Use the search input at the top of the archive view |
| Leave the archive | Click the back arrow or press `Esc` |
| Unarchive a chat | Right-click the archived chat → **Unarchive** |

## Settings

You can configure the following options in BetterDiscord's plugin settings (`⚙️`):
- **Mute chats when archiving**: Automatically mutes notifications for archived chats and restores them upon unarchiving.
- **Look up last messages**: Fetches recent message previews when opening the archive.
- **Remember last messages after a restart**: Persists message previews in local data storage.
- **Press Esc to leave the archive**: Enables quick navigation back using the `Esc` key.

## How it works

DMArchive runs locally through BetterDiscord, storing archived IDs, pins, and previews locally on your machine without sending data anywhere. It mirrors standard Discord row elements to match your current theme seamlessly.

## Disclaimer

DMArchive is an unofficial plugin and is not affiliated with or endorsed by Discord. Client modifications such as BetterDiscord are not supported by Discord and may go against its Terms of Service, so use this plugin at your own risk.

## Contributing

Bug reports, ideas, and pull requests are welcome. If something looks wrong after a Discord update, open an issue and include your BetterDiscord version and a screenshot.

## Author

Made by **Ziyad Sultan**.

## License

[MIT](LICENSE)
