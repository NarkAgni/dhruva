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

## [4.9] - 22-10-2026

### New
* **Fullscreen Option for Smart Auto-Hide (#95):** With Smart auto-hide, you can now choose what the dock does over fullscreen apps and games, under Behavior → Auto-Hide → In Fullscreen. **Hidden** keeps the dock out of the way until the app leaves fullscreen, **Delayed** needs a longer push at the screen edge (set it with Fullscreen Edge Push, never shorter than the normal Edge Push), and **Show** reveals it at the edge like on the desktop. Hidden is the default, so games no longer bring the dock up when the pointer reaches the bottom of the screen.

### Improved
* **Settings Stay Put After Updates:** Dhruva now remembers its defaults from the version you had before. If a default changes in an update, any setting you never touched keeps working the way it did before, and only new installs get the new default. Settings you changed yourself were never affected and still aren't.
* **Indicator Background Opacity (#97):** The opacity slider for the coloured box behind running apps now changes smoothly across its whole range. Before, everything from 1% to 20% looked the same.

### Fixed
* **Indicator Background Can Be Turned Off (#97):** Setting the opacity of the coloured box behind running apps to 0 now hides it completely, on hover too, including the App Grid button. Before, it stayed visible at about 20% no matter what, so there was no way to go back to just the dot under the icon.
* **Apps Opening on Release (#96):** With Magnify on Hover on, pressing the mouse button outside the dock and releasing it over an icon no longer opens that app. A click now only counts when it starts on the dock.
* **GNOME Dash in the Overview (#93):** Dragging a window in the overview no longer makes GNOME's own dash fade in behind Dhruva. It stays hidden until you leave the overview.
* **Icons Popping Up When Closing Apps:** Closing apps, especially two in a row, no longer makes the icons already on the dock shrink and pop up from below as if they were new. They now slide into place, and only icons that are actually new get the pop-in animation.
* **Fullscreen Edge Barrier (#95):** When the dock is set to stay hidden over a fullscreen app, the screen edge pressure barrier is now removed too, instead of staying active in the background.

### Changed
* **Ctrl + Right Click on the Dock:** Ctrl + right click on an empty part of the dock no longer opens Dhruva's settings directly. Right click the App Grid icon and choose Dhruva Settings instead.

## [4.8] - 21-10-2026

### New
* **Panel Separator (#90):** In Dynamic Panel mode, a separator now sits between your icons and modules and the top bar items. It stays centred in the gap, measured to the first applet or the tray arrow, and moves with them when they appear or disappear. Turn it on and set its thickness, length, colour and opacity under Appearance → Separators → Before Top Bar Items.
* **Date Format:** Choose how the date under the panel clock is written, from Panel → Clock → Date Format. Includes your system's own format, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD, YYYY/DD/MM, ISO 8601, dotted and dashed styles, short years, and formats with the month or weekday name. Each option shows today's date as an example.

### Improved
* **Wallpaper Color Theme (#91):** The theme now follows your light or dark style and takes its colour from the matching wallpaper, and changes as soon as you switch styles. Slideshow wallpapers, like the Fedora defaults, now use the colour of their first image.
* **Smoother Blur (#88):** The blur takes more samples and adds a very light dither, so large blur values and dark wallpapers look smooth, without steps or banding.

### Fixed
* **Invisible Dock with Wallpaper Color (#91):** With the Wallpaper Color theme and a wallpaper the image loader can't read (for example a slideshow or a JPEG XL file), the dock became invisible but still clickable, and settings like icon size and hover animation stopped working. Dhruva now falls back to a default colour instead.
* **Running Indicators Doubling (#88):** Right-click menus, dropdowns and other popups of an app are no longer counted as windows, so the running indicator no longer doubles when you open a menu in a browser or in Dhruva's settings. Clicking an icon also no longer tries to focus these popups.
* **Restore from Alt+Tab / Super+Tab (#90):** A minimized window restored from the window switcher now animates from its own place, instead of starting in the top left corner and then jumping back.
* **Quick Settings and Date Menu Popups (#90):** In Dynamic Panel mode, the Quick Settings and Date Menu popups now open centred over their buttons.
* **Pixelated Blur (#88):** The blur no longer looks blocky or pixelated.
* **"No signal connection found" Errors (#92):** Every full dock refresh logged thousands of these errors per session, and each removed icon left a small leftover in memory. Drag and drop on dock icons now hooks up its signals the way GNOME Shell expects, so the errors and the leftovers are gone.

## [4.7] - 19-10-2026

### Fixed
* **EGO Rules:** Fixes some EGO Rules.

## [4.6] - 18-10-2026

### Fixed
* **EGO Rules:** Remove return from destroy fucntions and clean try/catch.

## [4.5] - 18-10-2026

### New
* **Right Click Context Menu (#88):** Added dynamic panel support to seamlessly adapt and handle panel layouts with flexible sizing and automated spacing.
* **Background opacity (#88):** Background opacity of right click context menus, folder popups, tray menu, and overflow menu when blur is off.
* **Search Button on Setting:** Now you can search any setting using search button.
* **Buy My Coffee Button:** Add Buy Me a Coffee Button next to Search Button.

### Fixed
* **Blur Page:** Fix Highlight on Predefined options and added custom button.

## [4.4] - 17-10-2026

### New
* **Dynamic Panel:** Added dynamic panel support to seamlessly adapt and handle panel layouts with flexible sizing and automated spacing.
dynamic_panel.png
dynamic_panel_overflow.png
dynamic_panel_setting.png

### Fixed
* **Music Pill:** Fixed interaction and click propagation issues on the music pill inside dock mode.

## [4.3] - 17-10-2026

### Improved
* **Startup & Memory Cleanup:** Objects, caches and file references are now created only after the extension or preferences are opened, instead of as soon as the files are loaded.
* **Cleaner Signal & Timer Handling:** Signal connections across the extension and preferences now use `connectObject` and `disconnectObject`, and single, staggered and async timers are tracked and cleared reliably on destroy.
* **Safer Background Operations:** Asynchronous file, network and dialog operations now use `Gio.Cancellable` so pending work stops cleanly as soon as the dock or preferences window closes.
* **GJS Compatibility:** Removed restricted operators and manual destruction flags for stricter GNOME Shell extension review compliance.

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
