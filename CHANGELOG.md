## [4.0] - 15-10-2026

### New
* **Panel Mode (#73):** An optional mode that brings the GNOME top bar into the dock. The bar holds a workspace indicator, an extension tray, Quick Settings, and the clock with its calendar. Notification banners appear next to the dock. It works on all four screen edges, and every extra monitor gets its own clock.
panel_mode.png
* **Extension Tray:** In Panel mode, small icons from other extensions sit behind an arrow. Each icon can be pinned to the bar or reordered, and a single reset in preferences tidies the tray back to its default order.
extension_tray.png
* **Overflow Menu:** In Panel mode, apps that no longer fit on the bar move into an overflow menu instead of being cut off.
overflow_menu.png
* **Folder Customization:** Folders can be renamed inline. Each folder can have its own plate colour, letter style and letter size, or use a custom image or emoji as its icon. A reset brings back the default look. Apps inside a folder can be reordered by dragging.
folder_style.png
* **New Emoji Picker:** Adds search, categories, recently used emojis, a preview, and full keyboard navigation.
emoji_picker.png
* **Redesigned Preferences:** Adds a new Panel page and a live dock preview on the Appearance page. Includes a visual screen-edge picker and a reset button on each group. Options that do not apply to the current setup are hidden.
layout.png
panel.png
appearance.png
blur.png
* **Empty Trash Confirmation:** Emptying the Trash now asks for confirmation, and the files are deleted in the background.
* **Trash Animation:** Dragging an icon off the dock now plays a short puff animation.

### Improved
* **Unpinned App Order (#74):** Running apps that are not pinned now keep their launch order. Clicking or focusing an app no longer swaps it with its neighbours, so repeated clicks cycle through the windows of the same app.
* **Docks on a Shared Monitor Edge (#75):** When the dock sits on an edge shared with another monitor, it no longer adds an edge barrier or reserves screen space there. The pointer can move freely to the other monitor. While a window is being dragged, the dock steps aside so the window can cross to the other screen.
* **Music Pill (#76):** The pill now appears as soon as a track starts playing, and artwork colours are applied correctly. The player connection no longer blocks the shell. The Music Pill currently supports Spotify only, and the preferences now say so.
* **Hover Zoom (#71):** Icons and the dock background now settle back to their resting state when the pointer leaves the icons, including in full-width and Panel mode. Frame timing is smoother, and clicks go to the nearest icon even while zoomed.
* **Magic Lamp:** The effect is rewritten with a smoother bend and slide toward the dock icon.
* **Dynamic Indicator:** The running indicator now animates its length when an app gains or loses focus.
* **Show Desktop:** Only windows on the current workspace are affected. A second click restores exactly the windows that were hidden.
* **Menus and Popups:** Context menus, the folder menu, the tray and the overflow menu share one style. The blur behind them follows the arrow shape.
* **Responsiveness:** Blocking file and D-Bus calls were replaced with asynchronous ones, covering Trash checks, the music player, lyrics and album art. The album art cache is capped at 100 files, and the lyrics cache at 300 songs.
* **Independent Mode Shortcut:** A new shortcut takes effect as soon as it is changed in preferences.
* **GNOME Dash:** The overview dash is hidden and restored from one place, so it comes back correctly when switching modes or monitors.

### Fixed
* **App Folders Losing Position (#82):** With docks on more than one monitor, each dock kept its own copy of the folders and dock order. One dock could write an old copy back and move all folders to the end. All docks now share one copy.
* **Folder Name Reset:** Renamed folders no longer go back to "New Folder" after the dock refreshes.
* **Add to Folder:** The "Add to …" entry in the app context menu now always adds the app, and it shows the real folder name.
* **Extension Failing to Enable on Login (#81):** The Trash monitor now starts after a short delay and retries if the Trash backend is still mounting. It also reconnects after an unmount, and an error there no longer stops the dock from loading.
* **Icon Click Effect and Version Text (#80):** Click animations are no longer cancelled by the hover zoom reset. The About page shows the correct version.
* **Missing Settings Keys (#79):** The schema includes `autohide-animation-speed` and `window-effect-speed`, so preferences open without errors.

### Changed Defaults
* Panel mode is on by default.
* Running indicator style is now Dynamic, and the glow is off.
* Icon size is 32 px, the dock height is 8 px, and the end padding and edge gap are 0.
* Corner radius is 18 px, the outline is 1 px at 10% opacity, and the background opacity is 75%.
* The App Grid button sits at the start, and the clock sits at the end.
* Home, Trash, mounted drives and the pinned/running separator are off by default.
* Separators are thinner (1 px) and lighter.
* Minimize animation duration is 450 ms.
* The unused `indicator-spacing` setting has been removed.

## [3.1] - 05-10-2026

### New
* **Configurable Animation Durations:** Added dedicated preference controls to adjust Dock slide in/hide speed (`autohide-animation-speed`) and Window minimize/restore speed (`window-effect-speed`, Magic Lamp and other deform effects) dynamically in milliseconds.
* **Fullscreen Reveal in Intelligent Mode:** Added support for dock reveal in fullscreen windows exclusively when hide mode is set to "Intelligent (Dodge Active)" on screen edge pressure. In all other modes, the dock remains strictly hidden during fullscreen.
* **App Menu Drag and Drop Pinning:** Added support to drag and drop application icons directly from the GNOME App Grid / App Menu onto the dock to pin them in real time with dynamic slot gap expansion.

### Improved
* **Animation Physics & Deform Pipeline:** Connected `BaseDeformEffect` and Magic Lamp timelines directly to settings for fluid, slow-motion, or fast minimize transitions without hardcoded duration caps.
* **Backdrop Capture Reliability:** Hardened backdrop paint sequences in `BlurPanel` using guaranteed visibility restore logic to eliminate menu element fading.

### Fixed
* **Custom Icon Color Detection:** Fixed icon color extractor failing on modern icon theme hierarchies (like WhiteSur) where apps reside under `apps/scalable` and dark themes inherit from base parent icon folders.
* **Dynamic Blur Ghosting on Unhide:** Fixed dock icons appearing translucent or washed-out for 1-2 seconds after unhiding by eliminating conflicting intermediate opacity eases and triggering immediate backdrop recalculation.

## [3.0] - 04-10-2026

### New
* **Dock Blur Effect:** Added background blur to the dock with smooth animations and zero lag
* **Dual Blur Modes:**
  * **Dynamic Blur:** Real time adaptive blur that stays buttery smooth during system use
dynamic.png
  * **Static Blur:** Includes 5 built in presets with adjustable blur intensity Also supports setting custom images/banners with an interactive position slider and live preview
banner.png
preset.png
* **Dedicated Blur Preferences:** Added intuitive controls in settings to customize blur intensity pick presets or configure custom banner alignment
blur_settings.png
* **Music Pill Visual Enhancements:** Integrated background blur beneath the Dhruva music pill for a cleaner unified aesthetic
musicpill.png
* **Independent Dock Mode Shortcut:** Added a customizable hotkey to quickly toggle "Independent Dock Mode" on the fly
hotkey.png

## [2.6] - 01-10-2026

### Added
* **Project Tooling:** Added `manage.sh` automation script for build packaging, schema compilation, and release workflows.
* **Folder Symbolic Assets:** Added dedicated dock folder and plate symbolic icons (`folder-plate-symbolic.svg`, `folder-symbolic.svg`).

## [2.5] - 30-09-2026

### New
* **Folder Grid Preview:** Added multi-app 2x2 grid layout display option for folder plates directly on the dock.
folder_preview.png
* **Music Pill Popup:** Added interactive `MusicPillPopup` with media controls, player integration, and track details.
musicpillpopup.png
* **Adaptive Rounded Hover Backgrounds:** Added modern curved corner radius to running app indicators and hover backgrounds instead of flat sharp edges.
hover_preview.png
* **App Grid Module Hover:** Added smooth pill hover background styling for the Application Grid button.

### Improved
* **Dock Item Spacing:** Refined compact hover background geometry so running items stay tightly spaced without artificial gaps.
* **Hover Transitions:** Polished hover enter and leave transitions for both running and static dock modules.
* **Module Button Alignment:** Unified hover indicator backgrounds across system folders, trash, and custom folders.

### Fixed
* **Dock Height Inflation:** Fixed dock expanding vertically when icon hover backgrounds are rendered.
* **Vertical Clipping:** Fixed height truncation on app hover backgrounds when hover zoom magnification is disabled.
* **Hover State Reset:** Fixed App Grid background remaining active on open or click interactions.