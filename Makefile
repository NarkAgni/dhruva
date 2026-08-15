UUID         = dhruva@narkagni
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS_DIR  = schemas

all: install

build-schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

install: build-schemas
	rm -rf $(INSTALL_PATH)
	mkdir -p $(INSTALL_PATH)

	# Root files
	cp extension.js $(INSTALL_PATH)/
	cp prefs.js $(INSTALL_PATH)/
	cp stylesheet.css $(INSTALL_PATH)/
	cp metadata.json $(INSTALL_PATH)/

	# Icons
	cp -r icons $(INSTALL_PATH)/

	# Schemas
	cp -r schemas $(INSTALL_PATH)/

	# Source files
	mkdir -p $(INSTALL_PATH)/src
	cp -r src/core $(INSTALL_PATH)/src/
	cp -r src/prefs $(INSTALL_PATH)/src/
	cp -r src/ui $(INSTALL_PATH)/src/

	@echo "Dhruva installed successfully."
	@echo "Restart GNOME Shell to apply changes."

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
