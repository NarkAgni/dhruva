## [4.2] - 16-10-2026

### New
* **Reorder Panel Applets:** In Panel mode, hold Ctrl and drag an extension applet to move it among the others. The applet lifts up, follows the pointer and the others slide aside, just like icons on the dock. The order is saved, and applets always stay before the tray arrow.

### Improved
* **Tray Contents:** Only applets that are a single small icon go behind the tray arrow. Applets with text or a graph, like weather or system monitors, always stay on the panel.
* **Applet Hover:** Single icon applets on the panel now get the same rounded square hover as the other icons.
* **Applets on the Left:** Applets that their extension places on the left of the top bar now appear on the left of the panel, next to the workspace indicator.
* **Tidier Files:** Dhruva now keeps its files in the standard places: settings in `~/.config/dhruva@narkagni`, your custom icons and blur photos in `~/.local/share/dhruva@narkagni`, and album art, lyrics and emoji images in `~/.cache/dhruva@narkagni`. Existing files are moved there automatically on the first start, and the old `~/.cache/dhruva-music-art` folder is gone.
* **Blur Performance:** The background blur only follows windows and wallpaper while it is visible, which saves work when the dock or its popups are hidden.

### Fixed
* **Window Preview Closing on the Way (#85):** With Hover Zoom on, the preview no longer closes while the pointer moves from the icon up to it, even while the zoom animation is still settling or when the app has several windows.
* **Window Preview Staying Open:** The preview now closes as soon as the pointer leaves it to the top or the sides, including when an app window is underneath, and it no longer stays open while the pointer is in the empty space above the dock.
* **Panel Mode with Menu less Applets (#84):** Applets without a popup menu (for example WeatherOrNot) no longer stop the dock from loading in Panel mode. They now appear on the panel like the other applets.
* **Auto-Hide on Popups and Drag & Drop:** Fixed an issue where the dock or panel would incorrectly auto-hide when opening the Tray Menu, Overflow Menu, Quick Settings, Date Menu, Extension Applet popups, or while performing icon/applet drag and drop operations.

## [4.1] - 16-10-2026

### New
* **Hover Animation Setting:** A new switch under Behavior → Animations turns off the hover animation when Hover Zoom is off. The icon background still appears under the pointer, but it no longer stretches or fades, and neighbouring icons stay perfectly still.

### Improved
* **Hover Background:** The background behind hovered and running icons is slightly larger, without changing the dock size or icon spacing.
* **App Grid Button:** The App Grid button now follows the Hover Animation setting and uses the same hover background size as the other icons.
* **Independent Dock in the Overview:** When the overview closes, the dock fades out of the overview position right away and then slides up into its own place from the screen edge. Windows next to the dock edge are no longer pushed aside, and maximized windows no longer resize while the overview opens or closes.
* **Overview Animation:** The dock no longer rebuilds itself while the overview is animating, so opening and closing the overview stays smooth.
* **Independent Dock with Panel Mode:** In Panel mode the panel stays in place during the overview and the GNOME dash stays hidden. The "Show in Overview" option is hidden in Panel mode, since it only applies to the dock.
* **Auto-Hide Reveal:** The dock now fades in while it slides into view, instead of appearing at full opacity at once.

### Fixed
* **Windows Moved After the Overview:** With the independent dock shown in the overview, windows on the left edge were pushed to the right and stayed there after the overview closed.
* **Dock Stuck at the Bottom in the Overview:** The independent dock sometimes stayed at its normal place instead of moving to the left side of the overview.
* **Dock Blink:** The dock and its blur no longer blink once after returning to their place.
* **Notification Banners in Panel Mode:** Banner positioning no longer runs before the clock has been placed in the panel, which caused errors at login.
* **Log Warnings:** Repeated "Can't update stage views" warnings from the blur and invalid position warnings at login are gone.

### Changed Defaults
Dhruva now starts minimal, and every effect can be turned on in preferences.
* Panel mode is off.
* Hover Zoom, Hover Animation, window previews and Peek are off.
* Icon click effect and minimize animation are set to None.
* The Music Pill, Show Desktop button and notification badges are off.
* The dock theme is Default instead of Chameleon.
* Running indicators are small white dots (Dot style, custom colour, size 4).
* When Hover Zoom is turned on, it starts with the Fluid motion.

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