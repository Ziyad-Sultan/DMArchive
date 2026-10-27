/**
 * @name DMArchive
 * @author Ziyad Sultan
 * @authorLink https://github.com/Ziyad-Sultan
 * @description Archive DMs: an "Archived" row above your DMs opens a separate list, with a back arrow
 * @version 2.6.7
 */

const ITEM = '[data-list-item-id^="private-channels"]';

const ARCHIVE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>';
const PIN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>';
const BACK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';

// the Archived row is slightly greyer than a normal DM row
const GREY_TINT = "rgba(128,128,128,.15)";
const GREY_TINT_HOVER = "rgba(128,128,128,.25)";
// hover highlight for chats inside the archive list
const ROW_HOVER = "rgba(128,128,128,.12)";

// highlight of the archived chat you currently have open (used when your theme's own "open chat" look can't be copied)
const SELECTED_TINT = "rgba(128,128,128,.28)";
const SELECTED_TINT_HOVER = "rgba(128,128,128,.36)";

// message ids are numbers that grow with time, so the bigger id is the newer message
const newer = (a, b) => {
    try { return BigInt(a) > BigInt(b); } catch { return String(a) > String(b); }
};

const BADGE_STYLE = "position:absolute;right:12px;top:50%;transform:translateY(-50%);min-width:18px;padding:0 6px;border-radius:9px;font-size:12px;line-height:18px;text-align:center;color:#fff;font-weight:600;";

const STATUS_COLORS = {
    online: "#23a55a",
    idle: "#f0b232",
    dnd: "#f23f43",
    streaming: "#593695",
    offline: "#80848e"
};

// options of the small mute menu (only used if Discord's own menu can't be opened)
const MUTE_OPTIONS = [
    ["For 15 minutes", 900],
    ["For 1 hour", 3600],
    ["For 8 hours", 28800],
    ["For 24 hours", 86400],
    ["Until I turn it back on", -1]
];

// ---------- settings (shown in Settings > BetterDiscord > Plugins > DMArchive > ⚙️) ----------
const DEFAULT_SETTINGS = {
    muteOnArchive: true,
    fetchPreviews: true,
    savePreviews: true,
    escToGoBack: true
};

const SETTINGS = [
    {
        id: "muteOnArchive",
        name: "Mute chats when archiving",
        note: "Archiving a chat also mutes it, and unarchiving unmutes it again. Only chats DMArchive muted itself are unmuted, never ones you muted yourself. Muting is an account setting, so it also applies on your other devices."
    },
    {
        id: "fetchPreviews",
        name: "Look up last messages",
        note: "When an archived chat has no last message yet (or an old one), ask Discord for it: one chat at a time, with the same request Discord makes when you open the chat. Turn off to only use messages Discord already has in memory."
    },
    {
        id: "savePreviews",
        name: "Remember last messages after a restart",
        note: "Saves the last message of each archived chat in this plugin's data file. Turn off to keep them in memory only."
    },
    {
        id: "escToGoBack",
        name: "Press Esc to leave the archive",
        note: "While the archive list is open, Esc goes back to your normal DM list. If the search box has text, the first Esc clears it."
    }
];

module.exports = class DMArchive {
    start() {
        this.settings = { ...DEFAULT_SETTINGS, ...(BdApi.Data.load("DMArchive", "settings") ?? {}) };
        this.archived = new Set(BdApi.Data.load("DMArchive", "archived") ?? []);
        this.previews = this.settings.savePreviews ? (BdApi.Data.load("DMArchive", "previews") ?? {}) : {};
        this.pinned = BdApi.Data.load("DMArchive", "pinned") ?? []; // chats pinned to the top of the archive
        this.autoMuted = new Set(BdApi.Data.load("DMArchive", "automuted") ?? []); // chats we muted because they were archived
        this.muteChain = Promise.resolve(); // mute changes go out one at a time
        this.inArchive = false;
        this.scroller = null;
        this.viewSig = "";
        this.query = "";
        this.listEl = null;
        this.queued = false;
        this.menuPatched = false;
        this.menuTimer = null;
        this.viewTimer = null;
        this.maskId = 0;
        this.running = true;
        this.tried = new Set();
        this.fetchQueue = [];
        this.fetching = false;
        this.fetchTimer = null;
        // the browser's own nextElementSibling getter (only used when DMFolders is running)
        this.nextGetter = Object.getOwnPropertyDescriptor(Element.prototype, "nextElementSibling").get;

        // is DMFolders installed / enabled / disabled?
        const state = this.dmFoldersState();
        this.dmfEnabled = state === "enabled";
        console.log("[DMArchive] DMFolders is", state);

        // archived chats (and the hidden normal list) use this class, so we never fight DMFolders over inline styles
        const style = document.createElement("style");
        style.id = "dma-style";
        style.textContent = ".dma-hidden{display:none !important;}";
        document.head.append(style);

        // right-click a DM / group chat: Archive / Unarchive, right under "Add to folder" (if DMFolders added it)
        this.menuPatch = (tree, props) => {
            const channel = props?.channel;
            if (!channel?.id) return;
            if (channel.type !== 1 && channel.type !== 3) return; // 1 = DM, 3 = group chat
            if (!Array.isArray(tree?.props?.children)) return;

            const kids = tree.props.children;
            const item = BdApi.ContextMenu.buildItem({
                type: "text",
                id: "dma-toggle",
                label: this.archived.has(channel.id) ? "Unarchive" : "Archive",
                action: () => this.toggleArchive(channel.id)
            });

            // right under "Add to folder"; if that isn't there, at the very top
            const at = kids.findIndex(c => c?.props?.label === "Add to folder");
            kids.splice(at === -1 ? 0 : at + 1, 0, item);
        };
        // with DMFolders running, register a moment later so its item is already in the menu; otherwise straight away
        this.registerMenu(this.dmfEnabled ? 2000 : 0);

        // Esc leaves the archive list
        this.onKey = ev => this.onKeyDown(ev);
        document.addEventListener("keydown", this.onKey, true);

        // keep the "last message" of archived chats up to date as messages arrive
        this.flux = this.findModule("subscribe", "dispatch")
            ?? BdApi.Webpack.getStore("MessageStore")?._dispatcher
            ?? null;
        this.onCreate = e => this.onMessage("create", e);
        this.onUpdate = e => this.onMessage("update", e);
        this.onDelete = e => this.onMessage("delete", e);
        this.flux?.subscribe?.("MESSAGE_CREATE", this.onCreate);
        this.flux?.subscribe?.("MESSAGE_UPDATE", this.onUpdate);
        this.flux?.subscribe?.("MESSAGE_DELETE", this.onDelete);

        this.observer = new MutationObserver(() => this.queueRefresh());
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.refresh();

        // a few seconds after start, make sure archived chats have an up-to-date last message
        this.fetchTimer = setTimeout(() => {
            this.report();
            this.queueFetch(this.archivedIds());
        }, 4000);
    }

    // ---------- settings ----------
    saveSettings() {
        BdApi.Data.save("DMArchive", "settings", this.settings);
    }

    setSetting(id, value) {
        if (!(id in DEFAULT_SETTINGS)) return;
        this.settings[id] = !!value;
        this.saveSettings();

        if (id === "savePreviews") {
            if (value) this.savePreviews();
            else {
                try { BdApi.Data.delete("DMArchive", "previews"); } catch { /* ignore */ }
            }
        } else if (id === "fetchPreviews") {
            if (value) this.queueFetch(this.archivedIds());
            else this.fetchQueue.length = 0;
        }
    }

    // the ⚙️ button in the plugin list
    getSettingsPanel() {
        if (BdApi.UI?.buildSettingsPanel) {
            return BdApi.UI.buildSettingsPanel({
                settings: SETTINGS.map(s => ({ type: "switch", id: s.id, name: s.name, note: s.note, value: !!this.settings[s.id] })),
                // works whether Discord passes (group, id, value) or (id, value)
                onChange: (...args) => this.setSetting(args[args.length - 2], args[args.length - 1])
            });
        }

        // older BetterDiscord: a plain panel with checkboxes
        const panel = document.createElement("div");
        panel.style.padding = "16px";
        SETTINGS.forEach(s => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex;gap:12px;align-items:flex-start;margin-bottom:18px;cursor:pointer;color:#fff;";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = !!this.settings[s.id];
            box.style.marginTop = "4px";
            box.onchange = () => this.setSetting(s.id, box.checked);
            const text = document.createElement("div");
            const title = document.createElement("div");
            title.textContent = s.name;
            title.style.fontWeight = "600";
            const note = document.createElement("div");
            note.textContent = s.note;
            note.style.cssText = "font-size:13px;color:#b5bac1;margin-top:2px;";
            text.append(title, note);
            row.append(box, text);
            panel.append(row);
        });
        return panel;
    }

    // Esc: clear the search box first, then leave the archive. Does nothing while a popup or menu is open.
    onKeyDown(ev) {
        if (ev.key !== "Escape" || !this.settings?.escToGoBack || !this.inArchive) return;
        if (document.querySelector('[role="dialog"], [role="menu"]')) return; // let Discord close its own popup first

        const input = document.querySelector("#dma-view input");
        if (input && document.activeElement === input && this.query) {
            ev.preventDefault();
            ev.stopPropagation();
            input.value = "";
            this.query = "";
            this.fillList();
            return;
        }
        ev.preventDefault();
        ev.stopPropagation(); // so Discord doesn't also treat it as "mark channel as read"
        this.exitArchive();
    }

    // ---------- finding Discord's own functions ----------
    // Discord's code is split into many small modules, and the one we want is sometimes tucked inside
    // another export, so the plain look-up can miss it. Try the plain look-up, then ones that search deeper.
    findModule(...keys) {
        const cacheKey = keys.join("|");
        this.modCache ??= {};
        if (this.modCache[cacheKey]) return this.modCache[cacheKey];
        const W = BdApi.Webpack;
        const has = m => {
            try { return !!m && keys.every(k => m[k] !== undefined); }
            catch { return false; }
        };
        const tries = [
            () => W.getByKeys?.(...keys),
            () => W.getByKeys?.(...keys, { searchExports: true }),
            () => W.getModule?.(has, { searchExports: true }),
            () => W.getModule?.(has)
        ];
        for (const t of tries) {
            try {
                const m = t();
                if (m) return (this.modCache[cacheKey] = m);
            } catch { /* try the next way */ }
        }
        return null;
    }

    // Discord's own request function (the one it uses for everything it sends to its servers)
    findHttp() {
        return this.findModule("getAPIBaseURL", "patch")
            ?? this.findModule("get", "post", "put", "patch")
            ?? this.findModule("get", "post", "patch");
    }

    // says in the console which of Discord's functions were found (useful if something doesn't work)
    report() {
        const found = {
            "live messages": !!this.flux,
            "requests (get)": !!this.findHttp()?.get,
            "requests (patch, used for muting)": !!this.findHttp()?.patch,
            "mute function": !!this.findModule("updateChannelOverrideSettings"),
            "mark as read": !!(this.findModule("bulkAck") ?? this.findModule("ack")),
            "open a chat": !!this.findModule("transitionTo")
        };
        console.log("[DMArchive] Discord functions found:", found);
    }

    // ---------- DMFolders detection ----------
    // "enabled", "disabled" or "not installed"
    dmFoldersState() {
        const P = BdApi.Plugins;
        let installed = false;
        let enabled = false;
        try { installed = !!P?.get?.("DMFolders"); } catch { /* ignore */ }
        try { enabled = !!P?.isEnabled?.("DMFolders"); } catch { /* ignore */ }
        // its tab bar on the page is proof it is really running
        if (document.getElementById("dmf-bar")) enabled = true;
        return enabled ? "enabled" : installed ? "disabled" : "not installed";
    }

    // (re)registers the right-click menu patch; registering again moves us to the end of the line
    registerMenu(delay) {
        clearTimeout(this.menuTimer);
        this.menuTimer = setTimeout(() => {
            if (this.menuPatched) {
                BdApi.ContextMenu.unpatch("user-context", this.menuPatch);
                BdApi.ContextMenu.unpatch("gdm-context", this.menuPatch);
            }
            BdApi.ContextMenu.patch("user-context", this.menuPatch);
            BdApi.ContextMenu.patch("gdm-context", this.menuPatch);
            this.menuPatched = true;
        }, delay);
    }

    // gives the DMFolders tab bar its normal behaviour back
    releaseBar() {
        const bar = document.getElementById("dmf-bar");
        if (bar?.__dmaShim) {
            delete bar.nextElementSibling;
            delete bar.__dmaShim;
        }
    }

    // ---------- data ----------
    saveArchived() {
        BdApi.Data.save("DMArchive", "archived", [...this.archived]);
    }

    savePreviews() {
        if (this.settings.savePreviews) BdApi.Data.save("DMArchive", "previews", this.previews);
    }

    savePinned() {
        BdApi.Data.save("DMArchive", "pinned", this.pinned);
    }

    saveAutoMuted() {
        BdApi.Data.save("DMArchive", "automuted", [...this.autoMuted]);
    }

    // archive or unarchive one chat
    setArchived(id, on, quiet = false) {
        if (on === this.archived.has(id)) return;
        let muting = null;
        if (on) {
            this.archived.add(id);
            this.seedPreview(id);
            this.queueFetch([id]);
            if (this.settings.muteOnArchive) muting = this.autoMute(id);
        } else {
            this.archived.delete(id);
            delete this.previews[id];
            this.pinned = this.pinned.filter(x => x !== id);
            if (this.autoMuted.has(id)) muting = this.autoUnmute(id);
        }
        this.saveArchived();
        this.savePreviews();
        this.savePinned();

        if (!quiet) {
            if (!muting) {
                BdApi.UI.showToast(on ? "Chat archived" : "Chat unarchived", { type: "success" });
            } else {
                muting.then(res => {
                    const [text, type] = this.archiveToast(on, res);
                    BdApi.UI.showToast(text, { type });
                });
            }
        }
        this.refresh();
        if (this.inArchive) this.renderView();
    }

    // the message after archiving / unarchiving. It only says "muted" if Discord really shows the chat as muted.
    archiveToast(on, res) {
        const did = on ? "Chat archived" : "Chat unarchived";
        if (res.state === "confirmed") return [on ? "Chat archived and muted" : "Chat unarchived and unmuted", "success"];
        if (res.state === "sent") {
            return [`${did}. ${on ? "Muting" : "Unmuting"} was requested, but Discord doesn't show it yet. Check the chat's menu.`, "warning"];
        }
        return [`${did}, but couldn't ${on ? "mute" : "unmute"} it${res.reason ? " (" + res.reason + ")" : ""}`, "error"];
    }

    toggleArchive(id) {
        this.setArchived(id, !this.archived.has(id));
    }

    confirmUnarchiveAll() {
        const n = this.archived.size;
        if (!n) return;
        BdApi.UI.showConfirmationModal("Unarchive all chats", `Move all ${n} archived chat${n === 1 ? "" : "s"} back to your DM list?`, {
            confirmText: "Unarchive all",
            danger: true,
            onConfirm: () => this.unarchiveAll()
        });
    }

    unarchiveAll() {
        const n = this.archived.size;
        const toUnmute = [...this.autoMuted].filter(id => this.archived.has(id));
        this.archived.clear();
        this.previews = {};
        this.pinned = [];
        this.saveArchived();
        this.savePreviews();
        this.savePinned();
        toUnmute.forEach(id => this.autoUnmute(id));
        BdApi.UI.showToast(`${n} chat${n === 1 ? "" : "s"} unarchived${toUnmute.length ? " and unmuted" : ""}`, { type: "success" });
        this.refresh();
        if (this.inArchive) this.renderView();
    }

    // archived chats that still exist, in the same order as your DM list
    archivedIds() {
        const all = BdApi.Webpack.getStore("PrivateChannelSortStore")?.getPrivateChannelIds?.() ?? [];
        return all.filter(id => this.archived.has(id));
    }

    curChannel() {
        return BdApi.Webpack.getStore("SelectedChannelStore")?.getChannelId?.();
    }

    // archived chats with the pinned ones first (in the order you pinned them)
    orderedIds() {
        const ids = this.archivedIds();
        const pinned = this.pinned.filter(id => ids.includes(id));
        return [...pinned, ...ids.filter(id => !pinned.includes(id))];
    }

    togglePin(id, quiet = false) {
        if (!this.archived.has(id)) return;
        const on = !this.pinned.includes(id);
        this.pinned = on ? [...this.pinned, id] : this.pinned.filter(x => x !== id);
        this.savePinned();
        if (!quiet) BdApi.UI.showToast(on ? "Chat pinned" : "Chat unpinned", { type: "success" });
        if (this.inArchive) this.renderView();
    }

    readInfo(ids) {
        const RS = BdApi.Webpack.getStore("ReadStateStore");
        let unread = 0, mentions = 0;
        ids.forEach(id => {
            if (RS?.hasUnread?.(id)) unread++;
            mentions += RS?.getMentionCount?.(id) ?? 0;
        });
        return { unread, mentions };
    }

    // changes whenever something shown in the archive list changes (unread, status, last message)
    makeSig(ids) {
        const cur = this.curChannel();
        return ids.map(id => {
            const r = this.readInfo([id]);
            return `${id}:${r.unread}:${r.mentions}:${this.getStatus(id)}:${this.formatPreview(id)}:${this.pinned.includes(id) ? "p" : ""}:${id === cur ? "s" : ""}`;
        }).join("\n");
    }

    // friend nickname, then display name, then username
    nameOf(uid) {
        const u = BdApi.Webpack.getStore("UserStore")?.getUser(uid);
        if (!u) return null;
        return BdApi.Webpack.getStore("RelationshipStore")?.getNickname?.(uid) || u.globalName || u.username;
    }

    // name, picture and subtitle of a DM or group chat
    getInfo(id) {
        const ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        const UserStore = BdApi.Webpack.getStore("UserStore");
        const ch = ChannelStore.getChannel(id);
        if (!ch) return { name: id, avatar: null, sub: "" };

        const avatarOf = uid => {
            try { return UserStore.getUser(uid)?.getAvatarURL?.(undefined, 40, false) ?? null; }
            catch { return null; }
        };

        if (ch.type === 1) { // 1-on-1 DM
            const uid = ch.recipients?.[0];
            return { name: this.nameOf(uid) || id, avatar: avatarOf(uid), sub: "" };
        }
        const names = (ch.recipients || []).map(uid => this.nameOf(uid)).filter(Boolean);
        return {
            name: ch.name || names.join(", ") || id,
            avatar: ch.icon ? `https://cdn.discordapp.com/channel-icons/${ch.id}/${ch.icon}.png?size=40` : null,
            sub: `${(ch.recipients?.length ?? 0) + 1} Members`
        };
    }

    // everything a chat can be searched by: nickname, display name, username (and group name)
    getSearchText(id) {
        const ch = BdApi.Webpack.getStore("ChannelStore")?.getChannel(id);
        if (!ch) return "";
        const UserStore = BdApi.Webpack.getStore("UserStore");
        const RelationshipStore = BdApi.Webpack.getStore("RelationshipStore");

        const parts = [ch.name];
        (ch.recipients || []).forEach(uid => {
            const u = UserStore?.getUser(uid);
            parts.push(RelationshipStore?.getNickname?.(uid), u?.globalName, u?.username);
        });
        return parts.filter(Boolean).join(" ").toLowerCase();
    }

    // online / idle / dnd / offline for a 1-on-1 DM (null for group chats)
    getStatus(id) {
        const ch = BdApi.Webpack.getStore("ChannelStore")?.getChannel(id);
        if (ch?.type !== 1) return null;
        const s = BdApi.Webpack.getStore("PresenceStore")?.getStatus?.(ch.recipients?.[0]);
        return STATUS_COLORS[s] ? s : "offline";
    }

    // ---------- last message preview ----------
    previewText(msg) {
        const text = String(msg?.content ?? "")
            .replace(/<((?:https?|[a-z][a-z0-9+.-]*):\/\/[^>\s]+)>/gi, "$1")
            .replace(/\s+/g, " ")
            .trim();
        if (text) return text.slice(0, 120);
        if (msg?.attachments?.length) return "Attachment";
        if (msg?.stickerItems?.length || msg?.sticker_items?.length) return "Sticker";
        if (msg?.embeds?.length) return "Link";
        return "";
    }

    // the newest message Discord has in memory for a chat, from any sender. Discord's own "last message"
    // pointer can lag behind, so the newest of everything it has wins.
    bestMessage(id) {
        const MS = BdApi.Webpack.getStore("MessageStore");
        const CS = BdApi.Webpack.getStore("ChannelStore");
        const RS = BdApi.Webpack.getStore("ReadStateStore");
        const cands = [];
        const col = MS?.getMessages?.(id);
        const tail = col?.last?.() ?? col?.toArray?.().slice(-1)[0];
        if (tail) cands.push(tail);
        [CS?.getChannel(id)?.lastMessageId, RS?.lastMessageId?.(id)].forEach(mid => {
            const m = mid ? MS?.getMessage?.(id, mid) : null;
            if (m) cands.push(m);
        });
        return cands.reduce((best, m) => (!best || newer(m.id, best.id) ? m : best), null);
    }

    // use the newest message Discord has if it is newer than the one we show; true if something changed
    syncPreview(id) {
        const msg = this.bestMessage(id);
        const text = this.previewText(msg);
        if (!msg || !text) return false;
        const cur = this.previews[id];
        if (cur && cur.id === msg.id && cur.text === text) return false;
        if (cur && cur.id !== msg.id && !newer(msg.id, cur.id)) return false;
        this.previews[id] = { id: msg.id, authorId: msg.author?.id, text };
        return true;
    }

    seedPreview(id) {
        return this.syncPreview(id);
    }

    syncAll(ids) {
        let changed = false;
        ids.forEach(id => {
            if (this.syncPreview(id)) changed = true;
        });
        if (changed) this.savePreviews();
        return changed;
    }

    // live updates for archived chats
    onMessage(kind, e) {
        const msg = e?.message;
        const channelId = e?.channelId ?? msg?.channel_id ?? msg?.channelId;
        if (!channelId || !this.archived.has(channelId)) return;
        const cur = this.previews[channelId];

        if (kind === "create") {
            const text = this.previewText(msg);
            if (!msg || !text) return;
            this.previews[channelId] = { id: msg.id, authorId: msg.author?.id, text };
        } else if (kind === "update") {
            if (!cur || !msg || cur.id !== msg.id || msg.content === undefined) return;
            const text = this.previewText(msg);
            if (text) cur.text = text;
        } else if (kind === "delete") {
            if (!cur || cur.id !== e.id) return;
            delete this.previews[channelId];
        }
        this.savePreviews();
        this.queueRefresh();
    }

    // asks Discord for the newest message of archived chats that have no preview or an old one
    queueFetch(ids) {
        if (!this.settings.fetchPreviews) return;
        const CS = BdApi.Webpack.getStore("ChannelStore");
        ids.forEach(id => {
            const last = CS?.getChannel(id)?.lastMessageId ?? "none";
            const key = `${id}:${last}`;
            if (this.tried.has(key) || this.previews[id]?.id === last) return;
            this.tried.add(key);
            this.fetchQueue.push(id);
        });
        this.runFetch();
    }

    // one chat at a time, with a pause in between; stops for this session if Discord says no
    async runFetch() {
        if (this.fetching) return;
        this.fetching = true;
        const http = this.findHttp();
        let done = 0;
        try {
            while (http?.get && this.running && this.settings.fetchPreviews && this.fetchQueue.length && done < 30) {
                const id = this.fetchQueue.shift();
                if (!this.archived.has(id)) continue;
                const res = await http.get({ url: `/channels/${id}/messages`, query: { limit: 1 }, retries: 0 });
                const msg = res?.body?.[0];
                const text = this.previewText(msg);
                if (msg && text) {
                    this.previews[id] = { id: msg.id, authorId: msg.author?.id, text };
                    this.savePreviews();
                    this.queueRefresh();
                }
                done++;
                await new Promise(r => setTimeout(r, 400));
            }
        } catch (err) {
            console.warn("[DMArchive] couldn't look up a last message, will not try again this session", err);
            this.fetchQueue.length = 0;
        }
        this.fetchQueue.length = 0;
        this.fetching = false;
    }

    // "You: hi", "Name: hi" in group chats, or just the text in a 1-on-1 chat
    formatPreview(id) {
        const p = this.previews[id];
        if (!p?.text) return "";
        const me = BdApi.Webpack.getStore("UserStore")?.getCurrentUser?.()?.id;
        const ch = BdApi.Webpack.getStore("ChannelStore")?.getChannel(id);
        let prefix = "";
        if (p.authorId && p.authorId === me) {
            prefix = "You: ";
        } else if (ch?.type === 3 && p.authorId) {
            const n = this.nameOf(p.authorId);
            if (n) prefix = n + ": ";
        }
        return prefix + p.text;
    }

    openChat(id) {
        const path = `/channels/@me/${id}`;
        const nav = this.findModule("transitionTo");
        if (nav?.transitionTo) {
            nav.transitionTo(path);
        } else {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }
    }

    // ---------- muting ----------
    isMuted(id) {
        const S = BdApi.Webpack.getStore("UserGuildSettingsStore");
        try { return !!(S?.isChannelMuted?.(null, id) || S?.isChannelMuted?.("@me", id)); }
        catch { return false; }
    }

    // waits (up to a few seconds) for Discord's own state to show the new mute
    waitForMute(id, on, ms = 2500) {
        return new Promise(resolve => {
            const t0 = Date.now();
            const check = () => {
                if (this.isMuted(id) === on) return resolve(true);
                if (Date.now() - t0 >= ms) return resolve(false);
                setTimeout(check, 200);
            };
            check();
        });
    }

    // Changes the mute of a chat and CHECKS that Discord really shows the change before saying it worked.
    // 1. Discord's own function (it updates the app and the server together)
    // 2. the same request Discord's mute menu sends (DMs are filed under "@me")
    // Changes go out one at a time, with a short pause, so archiving many chats never sends a burst of requests.
    // Resolves to { state, reason }: "confirmed" (Discord shows the change), "sent" (asked, but Discord
    // doesn't show it) or "failed".
    applyMute(id, seconds, on) {
        const run = async () => {
            if (!this.running) return { state: "failed", reason: "plugin stopped" };
            const settings = on
                ? { muted: true, mute_config: { selected_time_window: seconds, end_time: seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null } }
                : { muted: false, mute_config: null };
            let sent = false;
            let reason = "";

            // 1. Discord's own function (it takes ONE object, like Discord's own mute menu sends)
            const mod = this.findModule("updateChannelOverrideSettings");
            if (mod?.updateChannelOverrideSettings) {
                for (const guild of [null, "@me"]) {
                    try {
                        mod.updateChannelOverrideSettings({ guildId: guild, channelId: id, settings, label: on ? "muted" : "unmuted" });
                        sent = true;
                    } catch (err) {
                        reason = "Discord's mute function failed";
                        console.warn("[DMArchive] Discord's mute function failed", err);
                        continue;
                    }
                    if (await this.waitForMute(id, on, 1500)) {
                        console.log("[DMArchive] Discord's own function changed the mute of", id);
                        return { state: "confirmed", reason: "" };
                    }
                }
            }

            // 2. the request itself
            const http = this.findHttp();
            if (http?.patch) {
                try {
                    await http.patch({ url: "/users/@me/guilds/@me/settings", body: { channel_overrides: { [id]: settings } } });
                    sent = true;
                    if (await this.waitForMute(id, on, 3000)) {
                        console.log("[DMArchive] Discord accepted the request and shows the mute of", id);
                        return { state: "confirmed", reason: "" };
                    }
                } catch (err) {
                    reason = `Discord refused (${err?.status ?? err?.statusCode ?? err?.message ?? "error"})`;
                    console.warn("[DMArchive] mute request was refused", err);
                }
            } else if (!mod) {
                reason = "no request or mute function found";
            }

            if (sent) {
                console.warn("[DMArchive] asked Discord to change the mute of", id, "but it doesn't show the change");
                return { state: "sent", reason: "Discord doesn't show the change yet" };
            }
            return { state: "failed", reason: reason || "no way to change mute found" };
        };
        const p = this.muteChain.then(run, run);
        this.muteChain = p.then(() => new Promise(r => setTimeout(r, 300)), () => {});
        return p;
    }

    // mute a chat because it was archived (unless you had already muted it yourself)
    async autoMute(id) {
        if (this.isMuted(id)) return { state: "confirmed", reason: "" };
        const res = await this.applyMute(id, -1, true);
        // if a request went out, remember it, so unarchiving sends the unmute
        if (res.state !== "failed" && this.archived.has(id)) {
            this.autoMuted.add(id);
            this.saveAutoMuted();
        }
        return res;
    }

    // undo that when the chat leaves the archive
    async autoUnmute(id) {
        this.autoMuted.delete(id);
        this.saveAutoMuted();
        return this.applyMute(id, null, false);
    }

    // from the menu: you choose how long (or unmute)
    muteChat(id, seconds, on) {
        // a mute you set yourself replaces ours, so unarchiving won't undo it
        if (this.autoMuted.delete(id)) this.saveAutoMuted();
        this.applyMute(id, seconds, on).then(res => {
            if (res.state === "confirmed") {
                BdApi.UI.showToast(on ? "Chat muted" : "Chat unmuted", { type: "success" });
            } else if (res.state === "sent") {
                BdApi.UI.showToast(`${on ? "Mute" : "Unmute"} requested, but Discord doesn't show it yet. Check the chat's menu.`, { type: "warning" });
            } else {
                BdApi.UI.showToast(`Couldn't change mute${res.reason ? " (" + res.reason + ")" : ""}. Open the chat and use its menu.`, { type: "error" });
            }
        });
    }

    // best effort: uses Discord's own "mark as read" function
    markRead(ids) {
        const RS = BdApi.Webpack.getStore("ReadStateStore");
        const CS = BdApi.Webpack.getStore("ChannelStore");
        const isUnread = id => !!RS?.hasUnread?.(id) || (RS?.getMentionCount?.(id) ?? 0) > 0;
        const todo = ids.filter(isUnread);
        if (!todo.length) {
            BdApi.UI.showToast("Already read", { type: "info" });
            return;
        }
        const mod = this.findModule("bulkAck") ?? this.findModule("ack");
        if (!mod) {
            BdApi.UI.showToast("Marking as read isn't available here. Open the chat instead.", { type: "error" });
            return;
        }
        try {
            if (mod.bulkAck) {
                mod.bulkAck(todo.map(id => ({
                    channelId: id,
                    messageId: RS?.lastMessageId?.(id) ?? CS?.getChannel(id)?.lastMessageId,
                    readStateType: 0
                })));
            } else {
                todo.forEach(id => mod.ack(id, true, true));
            }
        } catch (err) {
            console.error("[DMArchive] mark as read failed", err);
        }
        setTimeout(() => {
            const left = todo.filter(isUnread).length;
            BdApi.UI.showToast(
                left ? "Couldn't mark everything as read. Open the chat instead." : `Marked ${todo.length} chat${todo.length === 1 ? "" : "s"} as read`,
                { type: left ? "error" : "success" }
            );
            this.queueRefresh();
        }, 400);
    }

    // ---------- right-click menus ----------
    // right-click on the Archived row
    openRowMenu(ev) {
        const items = [
            { type: "text", id: "dma-add", label: "Add DMs to Archive…", action: () => this.openPicker("archive") },
            { type: "text", id: "dma-readall", label: "Mark all as read", action: () => this.markRead(this.archivedIds()) }
        ];
        if (this.archived.size) {
            items.push(
                { type: "separator" },
                { type: "text", id: "dma-all", label: "Unarchive all", danger: true, action: () => this.confirmUnarchiveAll() }
            );
        }
        BdApi.ContextMenu.open(ev, BdApi.ContextMenu.buildMenu(items));
    }

    // right-click on a chat in the archive list
    openChatMenu(ev, id) {
        const mute = this.isMuted(id)
            ? { type: "text", id: "dma-unmute", label: "Unmute Notifications", action: () => this.muteChat(id, null, false) }
            : {
                type: "submenu",
                id: "dma-mute",
                label: "Mute Notifications",
                items: MUTE_OPTIONS.map(([label, seconds]) => ({
                    type: "text",
                    id: "dma-mute-" + seconds,
                    label,
                    action: () => this.muteChat(id, seconds, true)
                }))
            };
        BdApi.ContextMenu.open(ev, BdApi.ContextMenu.buildMenu([
            { type: "text", id: "dma-open", label: "Open chat", action: () => this.openChat(id) },
            { type: "text", id: "dma-pin", label: this.pinned.includes(id) ? "Unpin" : "Pin to top", action: () => this.togglePin(id) },
            { type: "text", id: "dma-read", label: "Mark as read", action: () => this.markRead([id]) },
            mute,
            { type: "separator" },
            { type: "text", id: "dma-unarchive", label: "Unarchive", action: () => this.setArchived(id, false) }
        ]));
    }

    // popup with search. mode "archive": click chats to archive / unarchive them.
    // mode "pin": click archived chats to pin / unpin them.
    openPicker(mode = "archive") {
        const React = BdApi.React;
        const e = React.createElement;
        const self = this;

        const Avatar = ({ info }) => info.avatar
            ? e("img", { src: info.avatar, style: { width: 32, height: 32, borderRadius: "50%", objectFit: "cover" } })
            : e("div", { style: { width: 32, height: 32, borderRadius: "50%", background: "#5865f2", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 } },
                (info.name[0] ?? "?").toUpperCase());

        const Picker = () => {
            const [, force] = React.useReducer(x => x + 1, 0);
            const [query, setQuery] = React.useState("");
            const q = query.trim().toLowerCase();
            const allIds = mode === "pin"
                ? self.orderedIds()
                : BdApi.Webpack.getStore("PrivateChannelSortStore").getPrivateChannelIds();
            const ids = q ? allIds.filter(id => self.getSearchText(id).includes(q)) : allIds;

            return e("div", null,
                e("input", {
                    value: query,
                    autoFocus: true,
                    placeholder: "Search by username, display name or nickname",
                    style: { width: "100%", padding: "8px", marginBottom: "8px", boxSizing: "border-box", background: "#1e1f22", color: "#ffffff", border: "none", borderRadius: "4px" },
                    onChange: ev => setQuery(ev.target.value)
                }),
                e("div", { style: { maxHeight: "300px", overflowY: "auto" } },
                    ids.length === 0
                        ? e("div", { style: { padding: "12px", color: "#80848e" } }, mode === "pin" && !allIds.length ? "No archived chats to pin yet." : "No matches")
                        : ids.map(id => {
                            const info = self.getInfo(id);
                            const inside = mode === "pin" ? self.pinned.includes(id) : self.archived.has(id);
                            return e("div", {
                                key: id,
                                onClick: () => {
                                    if (mode === "pin") self.togglePin(id, true);
                                    else self.setArchived(id, !self.archived.has(id), true);
                                    force();
                                },
                                style: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px", cursor: "pointer", borderRadius: "6px", color: "#ffffff", background: inside ? "rgba(88,101,242,.2)" : "transparent" }
                            },
                                e(Avatar, { info }),
                                e("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, info.name),
                                e("span", { style: { color: inside ? "#5865f2" : "#80848e", fontWeight: 700 } }, inside ? "✓" : "+")
                            );
                        })
                )
            );
        };

        BdApi.UI.showConfirmationModal(mode === "pin" ? "Pin chats in the Archive" : "Add DMs to Archive", e(Picker), { confirmText: "Done" });
    }

    // ---------- building rows (copies of a real DM row, so they look the same) ----------
    getRows() {
        return [...document.querySelectorAll(ITEM)].map(el => {
            const id = el.getAttribute("data-list-item-id").match(/(\d{15,})$/)?.[1];
            return id ? { el, li: el.closest("li") ?? el, id } : null;
        }).filter(Boolean);
    }

    // a normal-looking row to copy: never the chat you have open, never one under the mouse
    pickTemplate(rows) {
        const cur = BdApi.Webpack.getStore("SelectedChannelStore")?.getChannelId?.();
        const innerOf = r => r.li.querySelector('[class*="interactive"]') ?? r.li.firstElementChild ?? r.li;
        const look = r => {
            const cs = getComputedStyle(innerOf(r));
            return cs.backgroundColor + "|" + cs.backgroundImage;
        };

        let pool = rows.filter(r =>
            !this.archived.has(r.id) && r.id !== cur && !r.li.matches(":hover") && r.li.style.display !== "none");
        if (!pool.length) pool = rows.filter(r => r.id !== cur);
        if (!pool.length) pool = rows;

        // the most common look is the normal one (an open or hovered chat looks different)
        const counts = new Map();
        pool.forEach(r => {
            const k = look(r);
            counts.set(k, (counts.get(k) ?? 0) + 1);
        });
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return pool.find(r => look(r) === best) ?? pool[0];
    }

    cloneRow(templateLi) {
        const row = templateLi.cloneNode(true);
        row.classList.remove("dma-hidden");
        row.style.display = "";
        // so Discord and other plugins don't mistake this for a real DM
        [row, ...row.querySelectorAll("[data-list-item-id]")].forEach(el => el.removeAttribute("data-list-item-id"));
        row.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
        // no navigation, no close/pin buttons
        row.querySelectorAll("a").forEach(a => a.removeAttribute("href"));
        row.querySelectorAll('button, [class*="closeButton"]').forEach(el => el.remove());
        // no pin icon (the row we copied may be a pinned chat)
        row.querySelectorAll("svg").forEach(el => el.remove());
        row.querySelectorAll("[class]").forEach(el => {
            const isPin = [...el.classList].some(c => /^pin/i.test(c));
            if (isPin && !el.querySelector('[class*="name_"], [class*="avatar_"]')) el.remove();
        });
        // never keep the "open chat" look
        [row, ...row.querySelectorAll("[class]")].forEach(el => {
            [...el.classList].filter(c => /selected/i.test(c)).forEach(c => el.classList.remove(c));
        });
        [row, ...row.querySelectorAll("[aria-current], [aria-selected]")].forEach(el => {
            el.removeAttribute("aria-current");
            el.removeAttribute("aria-selected");
        });
        return row;
    }

    // the small coloured status badge at the corner of a profile picture
    statusDot(status) {
        const color = STATUS_COLORS[status] ?? STATUS_COLORS.offline;
        const cut = "#111";
        let shape;
        if (status === "idle") {
            const id = "dma-m" + (++this.maskId);
            shape = `<mask id="${id}"><rect width="10" height="10" fill="#fff"/><circle cx="2.5" cy="2.5" r="3" fill="#000"/></mask><circle cx="5" cy="5" r="5" fill="${color}" mask="url(#${id})"/>`;
        } else if (status === "dnd") {
            shape = `<circle cx="5" cy="5" r="5" fill="${color}"/><rect x="2" y="4" width="6" height="2" rx="1" fill="${cut}"/>`;
        } else if (status === "offline") {
            shape = `<circle cx="5" cy="5" r="5" fill="${color}"/><circle cx="5" cy="5" r="2.2" fill="${cut}"/>`;
        } else {
            shape = `<circle cx="5" cy="5" r="5" fill="${color}"/>`;
        }
        const wrap = document.createElement("span");
        wrap.className = "dma-status";
        wrap.style.cssText = "position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;";
        wrap.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10">${shape}</svg>`;
        wrap.title = status === "dnd" ? "Do Not Disturb" : status.charAt(0).toUpperCase() + status.slice(1);
        return wrap;
    }

    setAvatar(row, templateLi, node, status) {
        const avatar = row.querySelector('[class*="avatar_"]');
        if (!avatar) return;
        const size = templateLi.querySelector('[class*="avatar_"]')?.getBoundingClientRect().width || 32;

        const wrap = document.createElement("div");
        wrap.style.cssText = `position:relative;width:${size}px;height:${size}px;flex:none;`;
        const box = document.createElement("div");
        box.style.cssText = "width:100%;height:100%;border-radius:50%;overflow:hidden;background:#4e5058;color:#fff;display:flex;align-items:center;justify-content:center;";
        box.append(node);
        wrap.append(box);
        if (status) wrap.append(this.statusDot(status));
        avatar.replaceChildren(wrap);
    }

    setText(row, name, sub) {
        const n = row.querySelector('[class*="name_"]');
        if (n) n.textContent = name;

        let s = row.querySelector('[class*="subText_"], .dma-sub');
        if (!s && sub && n) {
            // the row we copied had no second line, so add one
            const host = n.closest('[class*="content_"]') ?? n.parentElement?.parentElement ?? n.parentElement;
            s = document.createElement("div");
            s.className = "dma-sub";
            s.style.cssText = "font-size:12px;line-height:16px;color:var(--text-muted,#949ba4);";
            host?.append(s);
        }
        if (s) {
            s.textContent = sub;
            s.style.overflow = "hidden";
            s.style.textOverflow = "ellipsis";
            s.style.whiteSpace = "nowrap";
        }
    }

    // same background as a normal row, plus an optional grey tint (rest) and a hover tint
    styleRow(templateLi, row, rest, hover) {
        const find = el => el.querySelector('[class*="interactive"]') ?? el.firstElementChild;
        const tplInner = find(templateLi);
        const inner = find(row);
        if (!tplInner || !inner) return null;

        const cs = getComputedStyle(tplInner);
        inner.style.backgroundColor = cs.backgroundColor;
        if (cs.backgroundImage !== "none") {
            inner.style.backgroundImage = cs.backgroundImage;
            inner.style.backgroundSize = cs.backgroundSize;
            inner.style.backgroundPosition = cs.backgroundPosition;
            inner.style.backgroundRepeat = cs.backgroundRepeat;
        }
        inner.style.borderRadius = cs.borderRadius;
        inner.style.position = "relative"; // for the unread badge

        const tint = c => (c ? `inset 0 0 0 999px ${c}` : "none");
        inner.style.boxShadow = tint(rest);
        inner.addEventListener("mouseenter", () => (inner.style.boxShadow = tint(hover)));
        inner.addEventListener("mouseleave", () => (inner.style.boxShadow = tint(rest)));
        return inner;
    }

    makeArchivedRow(templateLi) {
        const row = this.cloneRow(templateLi);
        row.id = "dma-row";

        const icon = document.createElement("span");
        icon.style.display = "flex";
        icon.innerHTML = ARCHIVE_SVG;
        this.setAvatar(row, templateLi, icon, null);
        this.setText(row, "Archived", "0 chats");

        const inner = this.styleRow(templateLi, row, GREY_TINT, GREY_TINT_HOVER);
        const badge = document.createElement("span");
        badge.className = "dma-badge";
        badge.style.cssText = BADGE_STYLE + "display:none;";
        (inner ?? row).append(badge);

        row.style.cursor = "pointer";
        row.addEventListener("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this.enterArchive();
        }, true);
        row.addEventListener("contextmenu", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this.openRowMenu(ev);
        }, true);
        return row;
    }

    // how your theme draws the chat you have open, if that differs from a normal row (else null)
    selectedLook(rows, id, templateLi) {
        const real = rows.find(r => r.id === id);
        if (!real) return null;
        const find = el => el.querySelector('[class*="interactive"]') ?? el.firstElementChild;
        const a = find(real.li);
        const b = find(templateLi);
        if (!a || !b) return null;
        const ca = getComputedStyle(a);
        const cb = getComputedStyle(b);
        const key = c => c.backgroundColor + "|" + c.backgroundImage;
        if (key(ca) === key(cb)) return null;
        const nameEl = real.li.querySelector('[class*="name_"]');
        return {
            backgroundColor: ca.backgroundColor,
            backgroundImage: ca.backgroundImage,
            backgroundSize: ca.backgroundSize,
            backgroundPosition: ca.backgroundPosition,
            backgroundRepeat: ca.backgroundRepeat,
            nameColor: nameEl ? getComputedStyle(nameEl).color : null
        };
    }

    makeChatRow(id, templateLi, rows = [], cur = null) {
        const row = this.cloneRow(templateLi);
        const info = this.getInfo(id);

        let node;
        if (info.avatar) {
            node = document.createElement("img");
            node.src = info.avatar;
            node.style.cssText = "width:100%;height:100%;object-fit:cover;";
        } else {
            node = document.createElement("span");
            node.textContent = (info.name[0] ?? "?").toUpperCase();
            node.style.fontWeight = "600";
        }
        this.setAvatar(row, templateLi, node, this.getStatus(id));
        this.setText(row, info.name, this.formatPreview(id) || info.sub);

        // the chat you have open is highlighted: like your theme does it, or with a grey tint
        const isCurrent = !!cur && id === cur;
        const look = isCurrent ? this.selectedLook(rows, id, templateLi) : null;
        const inner = isCurrent && !look
            ? this.styleRow(templateLi, row, SELECTED_TINT, SELECTED_TINT_HOVER)
            : this.styleRow(templateLi, row, null, ROW_HOVER);
        if (inner && look) {
            inner.style.backgroundColor = look.backgroundColor;
            if (look.backgroundImage !== "none") {
                inner.style.backgroundImage = look.backgroundImage;
                inner.style.backgroundSize = look.backgroundSize;
                inner.style.backgroundPosition = look.backgroundPosition;
                inner.style.backgroundRepeat = look.backgroundRepeat;
            }
            const nameEl = row.querySelector('[class*="name_"]');
            if (nameEl && look.nameColor) nameEl.style.color = look.nameColor;
        }

        // unread: red number for mentions, white dot for plain unread
        const { unread, mentions } = this.readInfo([id]);
        const pinned = this.pinned.includes(id);
        if (inner && (unread || mentions)) {
            const badge = document.createElement("span");
            if (mentions > 0) {
                badge.textContent = String(mentions);
                badge.style.cssText = BADGE_STYLE + "background:#da373c;";
            } else {
                badge.style.cssText = "position:absolute;right:16px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;background:#fff;";
            }
            if (pinned) badge.style.right = "36px"; // make room for the pin icon
            inner.append(badge);
        }
        if (inner && pinned) {
            const pin = document.createElement("span");
            pin.className = "dma-pin";
            pin.title = "Pinned";
            pin.innerHTML = PIN_SVG;
            pin.style.cssText = "position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;opacity:.7;";
            inner.append(pin);
        }

        row.style.cursor = "pointer";
        row.addEventListener("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this.openChat(id);
        }, true);
        row.addEventListener("contextmenu", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this.openChatMenu(ev, id);
        }, true);
        return row;
    }

    // ---------- the archive view (replaces the DM list until you press back) ----------
    enterArchive() {
        const scroller = document.getElementById("dma-row")?.closest('[class*="scroller"]');
        if (!scroller) return;
        this.scroller = scroller;
        this.inArchive = true;
        this.query = "";
        scroller.classList.add("dma-hidden");
        this.renderView();
        // status changes don't always touch the page, so look again every few seconds while open
        clearInterval(this.viewTimer);
        this.viewTimer = setInterval(() => this.queueRefresh(), 3000);
    }

    exitArchive() {
        this.inArchive = false;
        this.query = "";
        this.listEl = null;
        clearInterval(this.viewTimer);
        this.viewTimer = null;
        this.scroller?.classList.remove("dma-hidden");
        this.scroller = null;
        document.getElementById("dma-view")?.remove();
    }

    // (re)builds the chat rows of the archive list, filtered by the search box
    fillList() {
        const list = this.listEl;
        if (!list?.isConnected) return;
        const rows = this.getRows();
        const tpl = rows.length ? this.pickTemplate(rows) : null;
        if (!tpl) return;

        const q = this.query.trim().toLowerCase();
        const ids = this.orderedIds().filter(id =>
            !q || (this.getSearchText(id) + " " + this.formatPreview(id).toLowerCase()).includes(q));

        list.replaceChildren();
        if (q && !ids.length) {
            const none = document.createElement("li");
            none.textContent = "No chats match your search.";
            none.style.cssText = "padding:8px;font-size:13px;opacity:.6;";
            list.append(none);
            return;
        }
        const cur = this.curChannel();
        ids.forEach(id => list.append(this.makeChatRow(id, tpl.li, rows, cur)));
    }

    renderView() {
        const scroller = this.scroller;
        if (!scroller?.isConnected) {
            this.exitArchive();
            return;
        }

        const ids = this.orderedIds();

        // bring the "last message" lines up to date with what Discord has in memory
        this.syncAll(ids);
        this.queueFetch(ids);
        this.viewSig = this.makeSig(ids);

        let view = document.getElementById("dma-view");
        if (!view) {
            view = document.createElement("div");
            view.id = "dma-view";
            view.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 8px 8px;box-sizing:border-box;color:var(--header-primary,#fff);";
            scroller.after(view);
        }

        // keep what you were doing in the search box (and the scroll position) across a re-draw
        const oldSearch = view.querySelector("input");
        const hadFocus = !!oldSearch && document.activeElement === oldSearch;
        const selStart = oldSearch?.selectionStart ?? null;
        const selEnd = oldSearch?.selectionEnd ?? null;
        const keepScroll = view.scrollTop;
        view.replaceChildren();

        // header: back arrow + title + count
        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:8px;padding:12px 4px 8px;";
        const back = document.createElement("button");
        back.title = this.settings.escToGoBack ? "Back (Esc)" : "Back";
        back.innerHTML = BACK_SVG;
        back.style.cssText = "display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;";
        back.onmouseenter = () => (back.style.background = "rgba(128,128,128,.25)");
        back.onmouseleave = () => (back.style.background = "transparent");
        back.onclick = () => this.exitArchive();
        const title = document.createElement("span");
        title.textContent = "Archived";
        title.style.cssText = "font-size:16px;font-weight:600;";
        const count = document.createElement("span");
        count.textContent = String(ids.length);
        count.style.cssText = "font-size:13px;opacity:.6;";
        const pinBtn = document.createElement("button");
        pinBtn.title = "Pin chats to the top of the archive";
        pinBtn.innerHTML = PIN_SVG.replace('width="14" height="14"', 'width="18" height="18"');
        pinBtn.style.cssText = "margin-left:auto;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;";
        pinBtn.onmouseenter = () => (pinBtn.style.background = "rgba(128,128,128,.25)");
        pinBtn.onmouseleave = () => (pinBtn.style.background = "transparent");
        pinBtn.onclick = () => this.openPicker("pin");
        header.append(back, title, count, pinBtn);
        view.append(header);

        if (ids.length) {
            const search = document.createElement("input");
            search.type = "text";
            search.placeholder = "Search archived chats";
            search.value = this.query;
            search.style.cssText = "width:100%;box-sizing:border-box;margin:0 0 8px;padding:7px 10px;border:none;border-radius:6px;background:rgba(128,128,128,.18);color:inherit;font-size:13px;outline:none;";
            search.addEventListener("input", () => {
                this.query = search.value;
                this.fillList();
            });
            view.append(search);
            if (hadFocus) {
                search.focus();
                try { search.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
            }
        }

        const note = document.createElement("div");
        note.style.cssText = "padding:0 8px 8px;font-size:12px;opacity:.6;";
        note.textContent = ids.length
            ? "Right-click a chat to pin it, mute it or unarchive it."
            : "No archived chats yet. Right-click a DM and choose Archive.";
        view.append(note);

        const list = document.createElement("ul");
        list.style.cssText = "list-style:none;margin:0;padding:0;";
        view.append(list);
        this.listEl = list;
        this.fillList();
        view.scrollTop = keepScroll;
    }

    // ---------- keeping everything in place ----------
    queueRefresh() {
        if (this.queued) return;
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            this.refresh();
        });
    }

    updateArchivedRow(row) {
        const ids = this.archivedIds();
        const { unread, mentions } = this.readInfo(ids);
        const sig = `${ids.length}|${unread}|${mentions}`;
        if (row.dataset.sig === sig) return;
        row.dataset.sig = sig;

        const sub = row.querySelector('[class*="subText_"], .dma-sub');
        if (sub) sub.textContent = `${ids.length} chat${ids.length === 1 ? "" : "s"}`;

        const badge = row.querySelector(".dma-badge");
        if (badge) {
            badge.textContent = unread > 0 ? String(unread) : "";
            badge.style.cssText = BADGE_STYLE + (unread > 0
                ? `display:block;background:${mentions > 0 ? "#da373c" : "#4e5058"};`
                : "display:none;");
        }
    }

    // (DMFolders only) DMFolders keeps its tab bar directly above the first DM. This makes that bar
    // ignore our Archived row when it looks at what comes next, so the two never fight over the position.
    shimBar(bar) {
        if (bar.__dmaShim) return;
        bar.__dmaShim = true;
        const real = this.nextGetter;
        Object.defineProperty(bar, "nextElementSibling", {
            configurable: true,
            get() {
                let n = real.call(this);
                while (n && n.id === "dma-row") n = real.call(n);
                return n;
            }
        });
    }

    // the Archived row goes right under the DMFolders tabs when DMFolders is running,
    // otherwise directly above the first DM
    placeRow(row, anchor) {
        const bar = this.dmfEnabled ? document.getElementById("dmf-bar") : null;
        if (bar && bar.parentElement === anchor.parentElement) {
            this.shimBar(bar);
            if (this.nextGetter.call(bar) !== row) bar.after(row);
        } else if (row.nextElementSibling !== anchor) {
            anchor.parentElement.insertBefore(row, anchor);
        }
    }

    refresh() {
        // notice DMFolders being turned on or off while Discord is running
        const enabled = this.dmFoldersState() === "enabled";
        if (enabled !== this.dmfEnabled) {
            this.dmfEnabled = enabled;
            console.log("[DMArchive] DMFolders is now", this.dmFoldersState());
            if (enabled) this.registerMenu(500); // re-register so our menu item stays under its "Add to folder"
            else this.releaseBar();              // drop the tab-bar workaround
        }

        const rows = this.getRows();
        if (!rows.length) {
            if (this.inArchive && !this.scroller?.isConnected) this.exitArchive();
            return;
        }

        // archived chats disappear from the normal list
        rows.forEach(r => r.li.classList.toggle("dma-hidden", this.archived.has(r.id)));

        let row = document.getElementById("dma-row");
        if (!row) row = this.makeArchivedRow(this.pickTemplate(rows).li);
        this.placeRow(row, rows[0].li);
        this.updateArchivedRow(row);

        if (this.inArchive) {
            if (!this.scroller?.isConnected) {
                this.exitArchive();
            } else {
                this.scroller.classList.add("dma-hidden");
                this.syncAll(this.orderedIds());
                if (!document.getElementById("dma-view") || this.makeSig(this.orderedIds()) !== this.viewSig) {
                    this.renderView();
                }
            }
        }
    }

    stop() {
        this.running = false;
        clearTimeout(this.fetchTimer);
        clearTimeout(this.menuTimer);
        this.observer?.disconnect();
        document.removeEventListener("keydown", this.onKey, true);
        this.flux?.unsubscribe?.("MESSAGE_CREATE", this.onCreate);
        this.flux?.unsubscribe?.("MESSAGE_UPDATE", this.onUpdate);
        this.flux?.unsubscribe?.("MESSAGE_DELETE", this.onDelete);
        if (this.menuPatched) {
            BdApi.ContextMenu.unpatch("user-context", this.menuPatch);
            BdApi.ContextMenu.unpatch("gdm-context", this.menuPatch);
            this.menuPatched = false;
        }
        this.exitArchive();
        this.releaseBar();

        document.getElementById("dma-row")?.remove();
        document.getElementById("dma-style")?.remove();
        document.querySelectorAll(".dma-hidden").forEach(el => el.classList.remove("dma-hidden"));
    }
};