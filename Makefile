UUID         = dhruva@narkagni
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS_DIR  = schemas

all: install

build-schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

install: build-schemas
	rm -rf $(INSTALL_PATH)
	mkdir -p $(INSTALL_PATH)
	mkdir -p $(INSTALL_PATH)/src/core
	mkdir -p $(INSTALL_PATH)/src/ui
	mkdir -p $(INSTALL_PATH)/src/ui/effects
	cp extension.js    $(INSTALL_PATH)/
	cp prefs.js        $(INSTALL_PATH)/
	cp stylesheet.css  $(INSTALL_PATH)/
	cp metadata.json   $(INSTALL_PATH)/
	cp -r icons/       $(INSTALL_PATH)/icons/
	cp -r schemas/     $(INSTALL_PATH)/schemas/
	cp src/core/*.js   $(INSTALL_PATH)/src/core/
	cp src/ui/*.js     $(INSTALL_PATH)/src/ui/
	cp src/ui/*.json     $(INSTALL_PATH)/src/ui/
	cp src/ui/effects/*.js  $(INSTALL_PATH)/src/ui/effects/
	@echo "Dhruva installed. Restart GNOME Shell to apply."

pack: build-schemas
	zip -r $(UUID).zip . \
		-x "*.git*" \
		-x "Makefile" \
		-x "README.md" \
		-x "media/*" \
		-x "*.zip"

uninstall:
	rm -rf $(INSTALL_PATH)
	@echo "Dhruva uninstalled."

clean:
	rm -f $(SCHEMAS_DIR)/gschemas.compiled
	rm -f *.zip
