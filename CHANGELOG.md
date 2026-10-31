## [5.1.9] - 31-10-2026

### Improved
* **Better Prepared for GNOME Updates:** Dhruva now uses GNOME Shell's official, public ways of doing things wherever GNOME offers them, for example when reserving the dock's space on screen and when playing the minimize and restore effects. The few places where Dhruva has to reach into GNOME's own internals are now gathered in one spot, so supporting a new GNOME version is quicker and less likely to break the dock.
* **Tidier Internals:** The dock's parts no longer reach into each other's private data. The music pill, wallpaper colours, recycle bin state, hovered icon and similar shared details now go through clearly named connections, and pieces that only one part needs, like drag-and-drop from the app grid, are kept inside that part. Nothing changes in how Dhruva looks or works, but future changes are safer.

## [5.1.8] - 31-10-2026

### New
* **Unit Tests:** Dhruva now has 62 automated tests that check its settings, layout modes, auto-hide, hover zoom maths, colours and app launch matching. They run with `./manage.sh test`, without needing a GNOME Shell session, and every pack and release runs them first, so a broken build can't be published.
* **Tab Completion for manage.sh:** `./manage.sh completion zsh` (or `bash`) prints a completion script for your shell. Add it to your shell config and `./manage.sh re` + Tab becomes `./manage.sh release`. After `release`, Tab suggests image files to attach.

### Improved
* **Snappier Hover Zoom:** Hover zoom no longer fights with leftover animations from the last time the icons settled, so icons follow the pointer more directly when you come back to the dock.
* **Lighter Auto-Hide Edge:** The invisible strip at the screen edge that brings the dock back now updates once per frame instead of on every small size change while icons zoom.
* **Cleaner Code Under the Hood:** A large internal cleanup of the dock, auto-hide, overview and settings code. Repeated code was merged, the dock's largest file was split into smaller parts, and a few settings that were never used were removed. Nothing changes in how Dhruva looks or works, but future fixes are safer and easier.

### Fixed
* **Dock Flickering Over Maximized Windows in Panel Mode:** In Panel and Dynamic Panel mode, with any auto-hide mode except Never, moving the pointer to the dock over a maximized window made it flicker for as long as the pointer stayed there, unless another window was open on top. The dock now shows smoothly.
* **Running Indicator Off-Centre:** Opening an app from the start menu could leave its running indicator shifted to the side and stretched under the icon. It now always sits centred under the icon.
* **Zoomed Icons Overlapping Top Bar Items:** In Panel and Dynamic Panel mode, clicking an icon to open an app could make the zoomed icons slide over the tray, Quick Settings and clock for a moment while they settled. The panel and icons now settle back together.
* **Super + Number Shortcuts Doing Nothing:** Right after logging in or coming back from the overview, Super + 1–9 could silently do nothing. It now opens the app every time.
* **Auto-Hide and Windows on Other Workspaces:** Windows that were already open on other workspaces when Dhruva started weren't watched by auto-hide, so moving or resizing them after switching workspaces didn't update the dock. All windows are watched now.

## [5.1.3] - 30-10-2026

### New
* **Keyboard Navigation in the Start Menu:** Press ↓ in the search box to jump to the first pinned app, search result or app in All Apps, then move around with the arrow keys and Tab. The list scrolls along with you, pinned pages turn on their own, and Enter or Space opens the selected item. The Menu key or Shift+F10 opens the right-click menu of the selected item, folders and right-click menus keep the keyboard inside them while open, and focus returns to where you were when they close. The selected item gets a clear outline so you always know where you are.
* **App Shortcuts:** Apps that offer extra actions, like Firefox's New Private Window, now show them on the best match card in search and in their right-click menu.
* **Calculator in Search:** Type a sum like `25*4` or `(2+3)^2` and the answer appears at the top of the results. Press Enter or Copy to copy it.
* **Run Commands:** Start the search with `>` followed by a command, like `> sudo apt update`, and press Enter to run it in your terminal. The terminal stays open afterwards so you can read the output. Press Ctrl+Enter instead to run it in the background, which is handy for opening apps like `> gnome-text-editor`.
* **Web Search:** The last search result offers to search the web for what you typed. DuckDuckGo is used by default, and you can set any other search address in the settings.
* **Results from Your Apps:** Search now also shows results from GNOME apps that support it, like emoji from Characters, events from Calendar and people from Contacts. It follows GNOME's own Search settings, so apps you turned off there stay off.
* **Pinned Pages:** When you pin more than 12 items, the Pinned section splits into pages with dots underneath. Scroll over it, click a dot or move with the arrow keys to turn the page. While dragging an app, hold it at the edge of the section to move to the next page.
* **More Power Options:** The power menu now has Switch User and Hibernate when your system supports them, and only shows options that are actually available.
* **Start Menu Settings:** New switches under Panel → App Grid Button let you hide Recent Apps or Continue Where You Left Off, turn off results from other apps or web search, and change the web search address.

### Improved
* **Tidier Search Results:** Each group of results shows the first four items with a Show More row for the rest, and the part of a name that matches what you typed is shown in bold.
* **Smoother Start Menu:** The start menu now slides in from the dock when it opens, and switching to All Apps, Search or back to Home has a short slide or fade.
* **All Apps Letter Bar:** The letter bar now lights up the letter of the apps at the top of the list. It starts on # or A, ends on the last letter when you reach the bottom, and stays on the letter you clicked. Apps whose names don't start with A–Z are always grouped under # at the top, and the letter bar now sits at the right edge, next to the scrollbar.
* **Scrollbars That Stay Out of the Way:** Home, Search and All Apps all use the same thin scrollbar on the right edge. It only appears while you scroll with the mouse or move the pointer close to it, and fades away again when you stop.
* **Recent Apps:** Apps that aren't running now say "Recently used" instead of "Frequent".
* **Faster Recent Files:** The start menu now only reads your recent files again when they actually change, so it opens faster.
* **Linked Files in Search:** Files that are shortcuts to other files now show the real file's icon and preview, and links that point to nothing no longer show up.
* **Smoother Hover Zoom:** Hover zoom now updates exactly once per screen refresh instead of on every mouse movement. Zooming feels the same with any mouse and on 60, 120 or 144 Hz screens, has no more small stutters, and uses less CPU.
* **Less Work When Windows Open and Close:** The dock no longer rebuilds all of its icons every time a window, dialog or app menu opens or closes. When only the running dots change, just the dots are updated, which removes the short hitch some users noticed.
* **Smoother Tooltips:** Tooltips follow their icon in step with the screen, their background is only redrawn when the arrow actually moves, and they stop working in the background once hidden.
* **Blur Follows the Dock:** The dock, tooltip and menu blur now moves together with the dock while icons zoom instead of trailing a frame behind, and no longer makes the whole screen recalculate its layout or the graphics card create new images on every frame.
* **Smoother Song Titles:** Long song titles on the Music Pill scroll in step with the screen and do no work while paused at either end.
* **Lighter Player Popup:** The wavy slider in the player popup moves in step with the screen at the same speed on any display, and the popup only updates text that has changed. Full lyrics are measured once instead of on every frame while scrolling, and lyrics on the pill are redrawn less often.
* **Auto-Hide While Dragging Windows:** When you drag a window over the dock, auto-hide now reacts while you are still dragging instead of waiting for you to stop.
* **Start Menu Blur:** The start menu now uses Dhruva's own blur, the same as folders, and Blur my Shell no longer blurs it on top.

### Fixed
* **Dynamic Blur flickers the screen, making it unusable (#108):** Fixed Dynamic Blur flickering issue 
* **Flickering and loss of icon animation (#100):** Fixed flickering issue on panel/dynamic panel mode.
* **Clicking the Dock Clock (#107):** With Magnify on Hover on, clicking the clock on the dock no longer opens the app next to it.
* **Zoom Around the Clock:** Hovering the dock clock no longer zooms the icon next to it.
* **Stretched Previews:** Photos, screenshots and icons in Continue Where You Left Off and in search results no longer look stretched. Photos fill their card and logos are shown whole.
* **Scrollbars Not Hiding:** On newer GNOME versions, the start menu scrollbars stayed visible all the time. They now hide as they should.
* **Window Effects with Fractional Scaling (#10, #106):** With display scaling like 125% or 166%, the minimize and restore effects now land exactly on the dock icon instead of stopping short. Thanks to @dsyfb437.
* **Start Menu Error in the Logs:** Fixed an error that could show up in the system log after the start menu was closed.
* **Flicker After Leaving the Overview:** With dynamic blur on, leaving the overview could make the screen flicker from the edges, freeze windows mid-animation and block all input, mostly seen on GNOME 50. Dynamic blur now pauses while the overview is shown and comes back on the desktop.
* **Folders Opening Again on a Second Click:** Clicking a folder on the dock while it is open now closes it instead of opening it again. The same goes for right-clicking an icon whose menu is already open.
* **See-Through Start Menu:** With blur turned on, the start menu no longer shows up without a background.

## [5.1.2] - 30-10-2026

### New
* **Presets:** A new Presets page, the first page in the settings, sets up a whole style in one click. Choose from Fresh Start, GNOME Classic+, macOS Dock, Windows 11 Taskbar, Classic Taskbar, Floating Island, Ubuntu Dock, Minimal and Showcase. A large preview shows the style before you apply it, and Apply sets it up. Presets only change how the dock looks and behaves; your pinned apps, folders and other settings stay as they are. The chosen preset is remembered across restarts, and if you change settings afterwards, the page shows that you have your own changes and offers Reset to Preset.
presets.png
* **Start Menu for Panel Mode:** In Panel and Dynamic Panel mode, the App Grid button now opens Dhruva's own start menu instead of GNOME's app grid. It shows your pinned apps, recent apps as cards, and the files you worked on last with real previews of photos and code. Your profile, Settings, Lock and power options sit at the bottom, and Lock and Power leave Quick Settings while the start menu is on. It follows your Dhruva theme and works with Blur my Shell. Turn it off under Panel → App Grid Button to get GNOME's app grid back.
start_menu.png
* **Search in the Start Menu:** Start typing to search apps, files and Settings panels. Files are found the same way GNOME Files finds them: through GNOME's file index when it is available and by looking through your Home folder, with closer, newer and better-matching files first. The best match gets a large card with Open, New Window, Pin to Start and Pin to Dock or Panel, and files show a preview of their contents.
start_menu_search.png
* **All Apps:** A full A–Z list of your apps with a letter bar on the side. The letter of the apps you are looking at lights up as you scroll, and a button switches between a list and a grid.
start_menu_all_apps.png
* **Pinned Apps and Folders:** Drag pinned apps to rearrange them, and the other icons slide out of the way just like on the dock. Hold Ctrl and drop one app on another to make a folder. Folders open in their own popup in the middle of the menu, where you can rename them, rearrange their apps or take apps out.
* **Right-Click Menus:** Right-click apps and files in the start menu to open them, open a new window, pin or unpin them from the start menu, pin them to the dock or panel, or show a file in Files.
* **Recent Files Setting:** Choose how many recent files the start menu shows, from 1 to 50. The list scrolls sideways.
* **Live Lyrics Switch:** The Music Pill page has a new Live Lyrics switch to turn the lyrics on the pill on or off.

### Improved
* **Music Pill Settings:** The Music Pill page now says that the pill works with browsers and other music players too, and the window click action is called Show or Hide Player.

### Fixed
* **Leftover Copy Song Link Option:** The Music Pill click actions no longer offer Copy Song Link, which was removed in 5.1 and did nothing when picked.

## [5.1.1] - 29-10-2026

### New
* **Music Pill Works with Any Player:** The Music Pill now works with any player that supports media controls, like Spotify, Rhythmbox, VLC or a browser playing YouTube, not just Spotify. When a player starts playing, the pill switches to it on its own. If more than one player is open, their icons appear at the top of the player popup, and clicking one keeps the pill on that player until it closes.
* **Full Lyrics in the Player Popup:** A new lyrics button in the player popup shows the whole song's lyrics over the album art, with the song info tucked away while it's open. The line being sung stays in the middle, larger and brighter, and the list scrolls smoothly as the song goes on. Click any line to jump to that part of the song.
* **Lyrics Timing:** If lyrics run ahead of or behind the song, the − and + buttons above the lyrics move them by half a second. Dhruva remembers this for each song.

### Improved
* **Lyrics in the Pill:** Lyrics in the Music Pill are larger, sit a little higher so they line up with the song title, use your system font and take their colour from the album art. They also scroll more smoothly.
* **Finding Lyrics:** Lyrics are found for more songs. Titles with a hyphen in the name, like "Anti-Hero", no longer get cut short, and Dhruva now also uses the album and the song's length to pick the right version instead of a remix or live recording.
* **Unsynced Lyrics:** When only plain lyrics are available, they now show in the player popup to read along, instead of scrolling through the pill at a guessed pace.
* **Readable Popup Controls:** The lyrics, shuffle and repeat buttons and the player icons in the popup now have the same background as the playback controls, so they stay easy to see on light album art. Player icons are shown in their own colours.
* **Album Art Colours:** Colours taken from very dark album art are brightened just enough to stay readable on the pill.

### Fixed
* **Time and Seeking in Browsers:** When music plays in a browser, the time in the player popup now keeps counting, the total length of the song shows correctly instead of 0:01, and moving the slider no longer sends it back to the start.

## [5.1] - 27-10-2026

### New
* **Magnify on Hover in Panel Mode:** Hover zoom now works in Panel and Dynamic Panel mode too, with the same settings as the dock. Turn it on under Behavior → Hover Zoom → Magnify on Hover. All the zoom options, like Motion, Zoom, Spread, Lift, Make Room and Motion Details, are now available in panel mode as well. Clicks on Quick Settings, the date, the tray and the Show Desktop button still open those items as usual.

### Improved
* **Dynamic Panel Grows with the Zoom:** With Make Room on, the dynamic panel now grows as icons zoom and shrinks back when you move away. The workspace indicator, tray, Quick Settings, date and the separator move together with the panel background, so nothing overlaps the zoomed icons. The panel never grows past the edge of the screen.
* **Zoom Stays Between Panel Items:** In Panel mode, zoomed icons stay in the space between the workspace indicator and the top bar items instead of sliding over them.
* **Overflow Button:** The overflow button now uses the same background as folders and zooms like the other icons. Its three dots stay sharp at any zoom level.
* **Overflow Menu Position:** The overflow menu now stays lined up with its button while the icons settle back after a zoom.

### Changed
* **Copy Link Removed:** The Copy Link click action for the Music Pill and the copy button in the music player popup have been removed, so Dhruva no longer accesses the clipboard at all. If one of your Music Pill clicks was set to Copy Link, it goes back to its default action.

## [5.0] - 23-10-2026

### New
* **Partly Hidden Dock:** Auto-hide can now leave a small part of the dock on screen instead of hiding it completely, under Behavior → Auto-Hide → Stays Visible. Hover that strip to bring the dock back. It is 0 by default, and the dock still hides completely over fullscreen apps.

### Improved
* **Games and Hidden Pointers:** When an app hides the pointer, like most games and video players, Dhruva now ignores the screen edge and fully hides any visible strip of a hidden dock, so it can't be brought up or clicked by accident. Once the pointer is visible again, auto-hide works as you set it up. Some games, often strategy games and MMOs, show their own pointer instead of hiding it; with Smart auto-hide, set In Fullscreen to Hidden (the default) for those.

### Fixed
* **Quick Settings Submenus in Dynamic Panel:** Submenus like Wi-Fi and Bluetooth now open inside the Quick Settings menu instead of shifting to the side.
* **Smooth Hiding Over Fullscreen Apps (#95):** The dock now slides away over fullscreen apps instead of disappearing abruptly.

---

Older versions: [4.x](docs/changelog/4.x.md) · [3.x and older](docs/changelog/3.x-and-older.md)