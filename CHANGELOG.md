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
