APP_NAME    := listnr
BUNDLE_ID   := com.archit.listnr
APP         := build/$(APP_NAME).app
BIN         := $(APP)/Contents/MacOS/$(APP_NAME)
SOURCES     := $(wildcard Sources/*.swift)
FONT_FILES  := $(wildcard Resources/Fonts/*)
ARCH        := $(shell uname -m)
SWIFT_FLAGS := -O -swift-version 5 -target $(ARCH)-apple-macos13.0
FRAMEWORKS  := -framework AppKit -framework ApplicationServices -framework AVFoundation -framework Carbon
.PHONY: build run install clean
all: build
build: $(BIN)
$(BIN): $(SOURCES) Info.plist Resources/AppIcon.icns Resources/Mark.png $(FONT_FILES)
	@mkdir -p "$(APP)/Contents/MacOS" "$(APP)/Contents/Resources"
	swiftc $(SWIFT_FLAGS) -o "$(BIN)" $(SOURCES) $(FRAMEWORKS)
	cp Info.plist "$(APP)/Contents/Info.plist"
	cp Resources/AppIcon.icns "$(APP)/Contents/Resources/AppIcon.icns"
	cp Resources/Mark.png "$(APP)/Contents/Resources/Mark.png"
	rm -rf "$(APP)/Contents/Resources/Fonts"
	cp -R Resources/Fonts "$(APP)/Contents/Resources/Fonts"
	BUNDLE_ID="$(BUNDLE_ID)" bash scripts/sign.sh "$(APP)"
run: build
	open "$(APP)"
install: build
	ditto "$(APP)" "/Applications/$(APP_NAME).app"
	@echo "Installed /Applications/$(APP_NAME).app"
clean:
	rm -rf build
