#!/usr/bin/env bash
# ==============================================================================
# manage.sh - GNOME Shell extension manager & release automation
# ==============================================================================
#
# USAGE
#    ./manage.sh <command> [arguments...]
#    ./manage.sh help            Show the detailed help menu.
#
# COMMANDS
#    install                     Compile schemas + translations and install the
#                                extension into ~/.local/share/gnome-shell/extensions/<uuid>.
#    pack                        Build a clean <uuid>.zip ready for upload to
#                                extensions.gnome.org (EGO).
#    release [image ...]         Pack, commit, push, tag and publish a GitHub
#                                Release. Optional image files are attached to
#                                the release and embedded in the release notes.
#                                Deletes local <uuid>.zip after successful upload.
#    uninstall                   Remove the extension from the local GNOME Shell dir.
#    clean                       Remove build artifacts (zip, locale/, gschemas.compiled).
#
# EXAMPLES
#    ./manage.sh install
#    ./manage.sh pack
#    ./manage.sh release
#    ./manage.sh release folder_test.png preview_test.png
#
# HOW IT WORKS (nothing is hardcoded)
#    * UUID and version are read from metadata.json ("uuid", "version-name" or "version").
#    * The list of files to package/install is auto-detected: every top-level file
#      and folder in the current directory is included, EXCEPT the names listed in
#      EXCLUDE_TOP below (dev files, docs, hidden files, other zips, ...).
#    * Translation .mo files are named after "gettext-domain" from metadata.json
#      (falls back to the UUID if not set).
#    * "release" pushes to, and targets the GitHub Release at, the branch that is
#      currently checked out (main, master, ...).
#    * Extra exclusions can be added on the fly without editing this script:
#          PACK_EXCLUDE="screenshots *.psd" ./manage.sh pack
#    * Run it from the extension root (the folder that contains metadata.json
#      and extension.js).
#
# REQUIREMENTS
#    install : glib-compile-schemas (only if schemas/ exists), msgfmt (only if po/ exists)
#    pack    : zip, msgfmt (only if po/ exists)
#    release : git, gh (GitHub CLI, already authenticated), zip
# ==============================================================================
set -e

SCHEMAS_DIR="schemas"
LOCALE_DIR="locale"
PO_DIR="po"

# Top-level names that are NEVER packaged/installed. Shell glob patterns are allowed.
# Hidden files/folders (.git, .github, .gitignore, ...) are already skipped automatically.
EXCLUDE_TOP=(
    "manage.sh"
    "Makefile"
    "README*"
    "CHANGELOG*"
    "LICENSE*"
    "LICENCE*"
    "po"
    "media"
    "media/*"
    "node_modules"
    "package.json"
    "package-lock.json"
    ".gitignore"
    "*.zip"
)

# Extra names to skip (filled by release_ext with the release image names).
EXTRA_EXCLUDES=()

show_help() {
    cat << 'HELP_EOF'
==============================================================================
 GNOME Extension Manager & Release Automation (Pure Bash)
==============================================================================

USAGE
  ./manage.sh <command> [arguments...]

  Run it from the extension root folder (the one with metadata.json and
  extension.js). UUID and version are read from metadata.json automatically.

COMMANDS
  install
      Compiles GSettings schemas (schemas/) and translations (po/*.po -> locale/*.mo),
      then copies the extension to:
        ~/.local/share/gnome-shell/extensions/<uuid>
      The old installed copy is removed first. Restart GNOME Shell afterwards
      (Wayland: log out/in, X11: Alt+F2 -> r) to load the new code.

  pack
      Builds a clean production zip named <uuid>.zip.
        - compiles translations first, so locale/ is included
        - removes schemas/gschemas.compiled (EGO compiles schemas itself)
        - skips dev files, docs and hidden files (see "WHAT IS PACKAGED")

  release [image1 image2 ...]
      Full release automation for version "v<version>" from metadata.json:
        1. Reads release notes from CHANGELOG.md (see "CHANGELOG FORMAT").
           If there is no CHANGELOG.md a generic note is used.
        2. Every image argument that exists is attached to the release. If the
           image file name appears in the changelog section, it is turned into
           an inline markdown image. Missing images are skipped with a warning.
           Images are NOT put inside the extension zip.
        3. Runs "pack" to build <uuid>.zip.
        4. git add -A, then un-stages the zip, locale/, gschemas.compiled and
           the release images so they never get committed.
        5. Commits ("release: v<version>") and pushes to origin on the
           branch you currently have checked out (main, master, ...).
        6. Creates/updates the git tag v<version> (force) and pushes it.
        7. Deletes an existing GitHub Release with the same tag (if any) and
           publishes a new one via "gh release create" with the zip + images.
        8. Removes the local <uuid>.zip file after the release is uploaded.
      WARNING: the tag is force-pushed and an existing release with the same
      tag is deleted and re-created. Bump the version for a genuinely new release.

  uninstall
      Removes the extension from ~/.local/share/gnome-shell/extensions/<uuid>.

  clean
      Removes build artifacts: <uuid>.zip, locale/ and schemas/gschemas.compiled.

  help, --help, -h
      Shows this menu.

WHAT IS PACKAGED (auto-detected, nothing hardcoded)
  Every top-level file/folder in the current directory is included
  (extension.js, prefs.js, stylesheet.css, metadata.json, src/, icons/,
  schemas/, po/, locale/, LICENSE, ... whatever exists in your project),
  EXCEPT:
    - hidden entries        (.git, .github, .gitignore, ...)
    - manage.sh, Makefile
    - README*, CHANGELOG*
    - media/, node_modules/
    - package.json, package-lock.json
    - *.zip
    - schemas/gschemas.compiled           (pack only; install keeps it)
    - __pycache__, .DS_Store, *.swp, *~   (anywhere in the tree)
  Build fails early if extension.js is missing, so you never ship an empty zip.

CUSTOM EXCLUDES
  Add space-separated names/globs via the PACK_EXCLUDE environment variable:
    PACK_EXCLUDE="screenshots *.psd" ./manage.sh pack
  To change the permanent list, edit EXCLUDE_TOP at the top of this script.
  Note: stray images in the project root are packaged by "pack"; keep them in
  media/ or exclude them via PACK_EXCLUDE. "release" excludes the images you
  pass as arguments automatically.

CHANGELOG FORMAT
  The release notes are the lines under the FIRST heading that starts with
  "## [" up to the next "## [" heading, for example:

    ## [1.2.0] - 2026-09-30
    * Added dock animations
    * Fixed EGO review warnings

    ## [1.1.0] - 2026-08-01
    ...

EXAMPLES
  ./manage.sh install
  ./manage.sh pack
  ./manage.sh release
  ./manage.sh release folder_test.png preview_test.png
  PACK_EXCLUDE="screenshots" ./manage.sh pack
  ./manage.sh uninstall
  ./manage.sh clean

REQUIREMENTS
  glib-compile-schemas (if schemas/ exists), msgfmt (if po/ exists), zip,
  git, and gh (GitHub CLI, logged in) for "release".
HELP_EOF
}

# Show help before requiring metadata.json, so "./manage.sh help" works anywhere.
case "${1:-}" in
    help|--help|-h|"")
        show_help
        exit 0
        ;;
esac

if [ ! -f "metadata.json" ]; then
    echo "Error: metadata.json was not found!"
    exit 1
fi

UUID=$(grep -Po '"uuid":\s*"\K[^"]*' metadata.json || true)
if [ -z "${UUID}" ]; then
    UUID="extension@custom"
fi

VERSION=$(grep -Po '"version-name":\s*"\K[^"]*' metadata.json || true)
if [ -z "${VERSION}" ]; then
    VERSION=$(grep -Po '"version":\s*\K[0-9]+' metadata.json || true)
fi

if [ -z "${VERSION}" ]; then
    echo "Error: Could not extract version from metadata.json!"
    exit 1
fi

ZIP_NAME="${UUID}.zip"
INSTALL_PATH="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

REPO_URL=$(git config --get remote.origin.url 2>/dev/null || true)
REPO_SLUG=$(echo "${REPO_URL}" | sed -E 's/.*github\.com[:/]//' | sed 's/\.git$//')
if [ -z "${REPO_SLUG}" ]; then
    REPO_SLUG="user/repo"
fi

# GNOME looks up translations by the "gettext-domain" from metadata.json.
# Many extensions set it to something other than the UUID, so read it (UUID = fallback).
GETTEXT_DOMAIN=$(grep -Po '"gettext-domain":\s*"\K[^"]*' metadata.json || true)
if [ -z "${GETTEXT_DOMAIN}" ]; then
    GETTEXT_DOMAIN="${UUID}"
fi

# GNOME Shell always loads extension.js, so it must exist in the current folder.
check_entry_point() {
    if [ ! -f "extension.js" ]; then
        echo "Error: extension.js not found! Run the script from the extension root directory."
        exit 1
    fi
}

# Fills the FILES array with every top-level entry that is not excluded.
collect_files() {
    FILES=()
    local -a user_excludes=()
    if [ -n "${PACK_EXCLUDE:-}" ]; then
        read -ra user_excludes <<< "${PACK_EXCLUDE}"
    fi

    local entry pat skip
    for entry in *; do
        [ -e "${entry}" ] || continue
        skip=0
        for pat in "${EXCLUDE_TOP[@]}" "${user_excludes[@]}" "${EXTRA_EXCLUDES[@]}"; do
            [ -n "${pat}" ] || continue
            case "${entry}" in
                ${pat})
                    skip=1
                    break
                    ;;
            esac
        done
        if [ "${skip}" -eq 0 ]; then
            FILES+=("${entry}")
        fi
    done

    if [ "${#FILES[@]}" -eq 0 ]; then
        echo "Error: No files found to package!"
        exit 1
    fi
}

build_schemas() {
    if [ -d "${SCHEMAS_DIR}" ]; then
        echo "--> Compiling GSettings schemas..."
        glib-compile-schemas "${SCHEMAS_DIR}"
    fi
}

build_locales() {
    if [ -d "${PO_DIR}" ]; then
        echo "--> Compiling PO translations to MO files..."
        for po in "${PO_DIR}"/*.po; do
            [ -f "${po}" ] || continue
            lang=$(basename "${po}" .po)
            mkdir -p "${LOCALE_DIR}/${lang}/LC_MESSAGES"
            msgfmt "${po}" -o "${LOCALE_DIR}/${lang}/LC_MESSAGES/${GETTEXT_DOMAIN}.mo"
        done
    fi
}

install_ext() {
    check_entry_point
    build_schemas
    build_locales
    collect_files

    echo "--> Installing extension to ${INSTALL_PATH}..."
    rm -rf "${INSTALL_PATH}"
    mkdir -p "${INSTALL_PATH}"

    for item in "${FILES[@]}"; do
        cp -r "${item}" "${INSTALL_PATH}/"
    done

    echo "=========================================================="
    echo "${UUID} installed successfully to ${INSTALL_PATH}"
    echo "=========================================================="
}

pack_ext() {
    check_entry_point
    build_locales

    rm -f "${SCHEMAS_DIR}/gschemas.compiled"
    rm -f "${ZIP_NAME}"

    collect_files

    echo "--> Creating production package: ${ZIP_NAME}..."
    echo "--> Including: ${FILES[*]}"

    zip -r "${ZIP_NAME}" \
        "${FILES[@]}" \
        -x "media/*" \
        -x "po/*" \
        -x "README*" \
        -x "LICENSE*" \
        -x "LICENCE*" \
        -x "Makefile" \
        -x ".gitignore" \
        -x "schemas/gschemas.compiled" \
        -x "*.git*" \
        -x "*__pycache__*" \
        -x "*.DS_Store*" \
        -x "*.swp" \
        -x "*~"

    echo "--> Package created successfully: ${ZIP_NAME}"
}

release_ext() {
    command -v gh >/dev/null 2>&1 || {
        echo "Error: GitHub CLI ('gh') is not installed or not in PATH."
        exit 1
    }

    TAG="v${VERSION}"
    DATE_IN=$(date "+%d-%m-%Y")

    # Use whatever branch is checked out (main, master, ...) instead of a hardcoded name.
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    if [ -z "${BRANCH}" ] || [ "${BRANCH}" = "HEAD" ]; then
        echo "Error: No branch is checked out (detached HEAD or not a git repo). Please check out a branch and try again."
        exit 1
    fi

    echo "--> Target Release: ${TAG} for ${UUID} (Dated: ${DATE_IN})"

    BODY_CONTENT="* Maintenance and bug fixes for ${TAG}."
    if [ -f "CHANGELOG.md" ]; then
        BODY_CONTENT=$(awk '
            BEGIN { found=0 }
            /^## \[/{
                if (found == 1) exit
                found = 1
                next
            }
            found == 1 { print }
        ' CHANGELOG.md)
    fi

    IMAGE_ATTACHMENTS=()
    UNSTAGE_IMAGES=()
    for img in "$@"; do
        if [ -f "${img}" ]; then
            img_basename=$(basename "${img}")
            img_url="https://github.com/${REPO_SLUG}/releases/download/${TAG}/${img_basename}"
            BODY_CONTENT=$(echo "${BODY_CONTENT}" | sed "s|${img_basename}|![${img_basename}](${img_url})|g")
            IMAGE_ATTACHMENTS+=("${img}")
            UNSTAGE_IMAGES+=("${img_basename}")
            echo "--> Attached image: ${img_basename}"
        else
            echo "Warning: Image file '${img}' not found. Skipping."
        fi
    done

    RELEASE_NOTES=$(printf "**Released on: %s**\n\n%s" "${DATE_IN}" "${BODY_CONTENT}")

    # Release images must not end up inside the extension zip.
    EXTRA_EXCLUDES=("${UNSTAGE_IMAGES[@]}")

    pack_ext

    echo "--> Staging and committing source files..."
    git add -A

    # Unstage root zip, locale, schemas, and release images passed via arguments (keep icons/media safe)
    # --ignore-unmatch: if a path is not tracked, remaining paths will still be unstaged
    git rm --cached -r -f -q --ignore-unmatch -- \
        "${LOCALE_DIR}/" \
        "${SCHEMAS_DIR}/gschemas.compiled" \
        "${ZIP_NAME}" \
        "${UNSTAGE_IMAGES[@]}" 2>/dev/null || true

    RELEASE_URL="https://github.com/${REPO_SLUG}/releases/tag/${TAG}"
    git commit -m "release: ${TAG}" -m "${BODY_CONTENT}" -m "Full Release Notes: ${RELEASE_URL}" || true

    echo "--> Pushing to ${BRANCH} branch..."
    git push origin "${BRANCH}"

    echo "--> Creating and pushing git tag: ${TAG}..."
    git tag -fa "${TAG}" -m "Release ${TAG}"
    git push origin "${TAG}" --force

    if gh release view "${TAG}" >/dev/null 2>&1; then
        echo "--> Previous release '${TAG}' detected. Deleting before re-publishing..."
        gh release delete "${TAG}" -y
    fi

    echo "--> Publishing GitHub Release via gh CLI..."
    gh release create "${TAG}" "${ZIP_NAME}" "${IMAGE_ATTACHMENTS[@]}" \
        --title "${UUID} - ${TAG}" \
        --notes "${RELEASE_NOTES}" \
        --target "${BRANCH}"

    # Remove the local zip file after successful upload/release
    echo "--> Removing local package file: ${ZIP_NAME}..."
    rm -f "${ZIP_NAME}"

    echo "=========================================================="
    echo "Release ${TAG} successfully published to https://github.com/${REPO_SLUG}/releases"
    echo "=========================================================="
}

uninstall_ext() {
    rm -rf "${INSTALL_PATH}"
    echo "--> ${UUID} uninstalled from ${INSTALL_PATH}"
}

clean_all() {
    rm -f "${SCHEMAS_DIR}/gschemas.compiled"
    rm -rf "${LOCALE_DIR}"
    rm -f "${ZIP_NAME}"
    echo "--> Cleaned build files."
}

ACTION="$1"
shift || true

case "${ACTION}" in
    install)
        install_ext
        ;;
    pack)
        pack_ext
        ;;
    release)
        release_ext "$@"
        ;;
    uninstall)
        uninstall_ext
        ;;
    clean)
        clean_all
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo "Error: Unknown command '${ACTION}'"
        echo ""
        show_help
        exit 1
        ;;
esac
