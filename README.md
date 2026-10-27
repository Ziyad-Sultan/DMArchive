# DMArchive

> A BetterDiscord plugin that adds a clean DM archiving system to Discord, complete with unread badges, message previews, pinning, and seamless compatibility with [DMFolders](https://github.com/Ziyad-Sultan/DMFolders).

---

## ✨ Features

- 📥 **Archived Row**: Adds an **Archived** row directly above your DMs (or right below your `DMFolders` tab bar if you use both plugins).
- 🗂️ **Dedicated Archive View**: Clicking the Archived row opens a separate list view with a back arrow and search bar to manage all your archived conversations.
- 📌 **Pin to Top**: Pin important archived chats to the very top of your archive list.
- 💬 **Last Message Previews**: Automatically tracks and displays the latest message preview for each archived chat.
- 🔕 **Optional Auto-Mute**: Automatically mutes chats when you archive them and unmutes them when you unarchive them (only applies to mutes set by the plugin).
- ⌨️ **Esc to Go Back**: Press `Esc` while inside the archive view to instantly return to your normal DM list (clears search text first if active).
- 🔗 **DMFolders Integration**: Fully detects when `DMFolders` is active and adjusts its layout automatically so both plugins work together seamlessly without overlapping.

---

## 📥 Installation

1. Download `DMArchive.plugin.js`.
2. Move the file into your BetterDiscord plugins folder:
   - **Windows**: `%appdata%\BetterDiscord\plugins`
   - **Linux**: `~/.config/BetterDiscord/plugins`
3. Enable **DMArchive** in your BetterDiscord settings.

---

## ⚙️ Settings

You can configure the following options in BetterDiscord's plugin settings (`⚙️`):
- **Mute chats when archiving**: Automatically mutes notifications for archived chats.
- **Look up last messages**: Fetches recent message previews when opening the archive.
- **Remember last messages after a restart**: Persists message previews in local data storage.
- **Press Esc to leave the archive**: Enables quick navigation back using the `Esc` key.

---

## 👤 Author

* **Ziyad Sultan** - [GitHub Profile](https://github.com/Ziyad-Sultan)
