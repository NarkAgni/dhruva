#!/usr/bin/env python3
import os
import sys
import re
import json
import subprocess
import shutil
import zipfile
from datetime import datetime

SCHEMAS_DIR = "schemas"
LOCALE_DIR = "locale"
PO_DIR = "po"

def load_metadata():
    if not os.path.exists("metadata.json"):
        print("Error: metadata.json nahi mila!")
        sys.exit(1)
    with open("metadata.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    uuid = data.get("uuid", "extension@custom")
    version = data.get("version-name") or str(data.get("version", "1"))
    return uuid, version

UUID, VERSION = load_metadata()
ZIP_NAME = f"{UUID}.zip"
INSTALL_PATH = os.path.expanduser(f"~/.local/share/gnome-shell/extensions/{UUID}")

def get_repo_slug():
    try:
        url = subprocess.check_output(["git", "config", "--get", "remote.origin.url"], text=True).strip()
        slug = re.sub(r"^.*github\.com[:/]", "", url)
        slug = re.sub(r"\.git$", "", slug)
        return slug if slug else "user/repo"
    except Exception:
        return "user/repo"

def build_schemas():
    if os.path.isdir(SCHEMAS_DIR):
        print("--> Compiling GSettings schemas...")
        subprocess.run(["glib-compile-schemas", SCHEMAS_DIR], check=True)

def build_locales():
    if os.path.isdir(PO_DIR):
        print("--> Compiling PO translations to MO files...")
        for file in os.listdir(PO_DIR):
            if file.endswith(".po"):
                lang = file[:-3]
                po_path = os.path.join(PO_DIR, file)
                out_dir = os.path.join(LOCALE_DIR, lang, "LC_MESSAGES")
                os.makedirs(out_dir, exist_ok=True)
                mo_path = os.path.join(out_dir, f"{UUID}.mo")
                subprocess.run(["msgfmt", po_path, "-o", mo_path], check=True)

def install_ext():
    build_schemas()
    build_locales()
    print(f"--> Installing extension to {INSTALL_PATH}...")
    if os.path.exists(INSTALL_PATH):
        shutil.rmtree(INSTALL_PATH)
    os.makedirs(INSTALL_PATH, exist_ok=True)

    for item in ["extension.js", "prefs.js", "stylesheet.css", "metadata.json"]:
        if os.path.exists(item):
            shutil.copy2(item, INSTALL_PATH)

    for folder in ["icons", "schemas", "src", "po"]:
        if os.path.isdir(folder):
            shutil.copytree(folder, os.path.join(INSTALL_PATH, folder))

    if os.path.isdir(LOCALE_DIR):
        shutil.copytree(LOCALE_DIR, os.path.join(INSTALL_PATH, LOCALE_DIR))

    print("==========================================================")
    print(f"{UUID} installed successfully to {INSTALL_PATH}")
    print("==========================================================")

def pack_ext():
    build_locales()
    compiled_schema = os.path.join(SCHEMAS_DIR, "gschemas.compiled")
    if os.path.exists(compiled_schema):
        os.remove(compiled_schema)
    if os.path.exists(ZIP_NAME):
        os.remove(ZIP_NAME)

    print(f"--> Creating production package: {ZIP_NAME}...")
    exclude_patterns = [
        "schemas/gschemas.compiled",
        "manage.sh",
        "Makefile",
        "README.md",
        "CHANGELOG.md",
        ".git",
        "__pycache__",
        ".DS_Store"
    ]

    with zipfile.ZipFile(ZIP_NAME, "w", zipfile.ZIP_DEFLATED) as zipf:
        items_to_add = ["extension.js", "prefs.js", "metadata.json", "stylesheet.css", "icons", "po", "schemas", "src"]
        if os.path.isdir(LOCALE_DIR):
            items_to_add.append(LOCALE_DIR)

        for item in items_to_add:
            if not os.path.exists(item):
                continue
            if os.path.isfile(item):
                zipf.write(item, item)
            elif os.path.isdir(item):
                for root, _, files in os.walk(item):
                    for f in files:
                        file_path = os.path.join(root, f)
                        if any(pattern in file_path for pattern in exclude_patterns):
                            continue
                        zipf.write(file_path, file_path)

    print(f"--> Package created successfully: {ZIP_NAME}")

def release_ext(images):
    if shutil.which("gh") is None:
        print("Error: GitHub CLI ('gh') is not installed or not in PATH.")
        sys.exit(1)

    tag = f"v{VERSION}"
    date_in = datetime.now().strftime("%d-%m-%Y")
    repo_slug = get_repo_slug()

    print(f"--> Target Release: {tag} for {UUID} (Dated: {date_in})")

    body_content = f"* Maintenance and bug fixes for {tag}."
    if os.path.exists("CHANGELOG.md"):
        with open("CHANGELOG.md", "r", encoding="utf-8") as f:
            lines = f.readlines()
        section_lines = []
        found = False
        for line in lines:
            if line.startswith("## ["):
                if found:
                    break
                found = True
                continue
            if found:
                section_lines.append(line)
        if section_lines:
            body_content = "".join(section_lines).strip()

    valid_images = []
    for img in images:
        if os.path.isfile(img):
            img_name = os.path.basename(img)
            img_url = f"https://github.com/{repo_slug}/releases/download/{tag}/{img_name}"
            body_content = body_content.replace(img_name, f"![{img_name}]({img_url})")
            valid_images.append(img)
            print(f"--> Attached image: {img_name}")
        else:
            print(f"Warning: Image file '{img}' not found. Skipping.")

    release_notes = f"**Released on: {date_in}**\n\n{body_content}"

    # Extension packaging
    pack_ext()

    # Source code stage aur commit (Sirf root artifacts ko exclude kiya jata hai)
    print("--> Staging and committing source files...")
    subprocess.run(["git", "add", "-A"], check=True)
    
    # Exclude root zip, locale, compiled schemas, aur release images (icons/media safe rahenge)
    unstage_list = [f"{LOCALE_DIR}/", f"{SCHEMAS_DIR}/gschemas.compiled", ZIP_NAME] + [os.path.basename(x) for x in valid_images]
    for item in unstage_list:
        subprocess.run(["git", "rm", "--cached", "-r", "-f", item], stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)

    subprocess.run(["git", "commit", "-m", f"release: {tag}"], check=False)

    print("--> Pushing to main branch...")
    subprocess.run(["git", "push", "origin", "main"], check=True)

    print(f"--> Creating and pushing git tag: {tag}...")
    subprocess.run(["git", "tag", "-fa", tag, "-m", f"Release {tag}"], check=True)
    subprocess.run(["git", "push", "origin", tag, "--force"], check=True)

    # Agar same release pehle se ho to remove karke clean recreate karo
    check_rel = subprocess.run(["gh", "release", "view", tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if check_rel.returncode == 0:
        print(f"--> Existing release '{tag}' detected. Removing before re-publishing...")
        subprocess.run(["gh", "release", "delete", tag, "-y"], check=True)

    print("--> Publishing GitHub Release via gh CLI...")
    gh_cmd = [
        "gh", "release", "create", tag, ZIP_NAME,
        "--title", f"{UUID} - {tag}",
        "--notes", release_notes,
        "--target", "main"
    ] + valid_images
    subprocess.run(gh_cmd, check=True)

    print("==========================================================")
    print(f"Release {tag} successfully published to https://github.com/{repo_slug}/releases")
    print("==========================================================")

def uninstall_ext():
    if os.path.exists(INSTALL_PATH):
        shutil.rmtree(INSTALL_PATH)
    print(f"--> {UUID} uninstalled from {INSTALL_PATH}")

def clean_all():
    compiled_schema = os.path.join(SCHEMAS_DIR, "gschemas.compiled")
    if os.path.exists(compiled_schema):
        os.remove(compiled_schema)
    if os.path.exists(LOCALE_DIR):
        shutil.rmtree(LOCALE_DIR)
    if os.path.exists(ZIP_NAME):
        os.remove(ZIP_NAME)
    print("--> Cleaned build files.")

def show_help():
    print("""GNOME Extension Manager & Release Automation

Usage:
  ./manage.sh  [arguments...]

Commands:
  install       Compiles schemas and translations locally, then installs extension.
  pack          Builds clean extension zip excluding dev files and compiled schemas.
  release       Automates versioning, changelog linking, git tag, and GitHub Release.
  uninstall     Removes extension from local GNOME Shell directory.
  clean         Removes build artifacts.
""")

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] in ["help", "--help", "-h"]:
        show_help()
        sys.exit(0)

    action = sys.argv[1]
    args = sys.argv[2:]

    if action == "install":
        install_ext()
    elif action == "pack":
        pack_ext()
    elif action == "release":
        release_ext(args)
    elif action == "uninstall":
        uninstall_ext()
    elif action == "clean":
        clean_all()
    else:
        print(f"Error: Unknown command '{action}'\n")
        show_help()
        sys.exit(1)
