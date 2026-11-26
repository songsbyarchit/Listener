# listnr for macOS

A menu-bar version of listnr that reads selected text in any app, not just
Chrome. It uses the Mac's British English voice for now; the Chrome extension
keeps the Kokoro and hosted voices.

## Build and run

```bash
cd mac
make run
# or, for a permanent copy:
make install
open /Applications/listnr.app
```

Grant **Accessibility** when macOS asks. Then select text in any app and press
**⌥L**. The small listnr bubble shows what is being read and offers Pause and
Stop. The menu bar also has Read clipboard, Read selection, appearance
(System, Light, Dark), and links to the Kernl folder and the Chrome extension.

The Chrome extension stays separate. Use it when you want the in-page player,
page highlighting, and Kokoro or hosted voices. Use this app when you want
listnr anywhere on the laptop.

The app is signed with the local Speekr identity when present, otherwise
ad-hoc. The icon and the in-app mark use the same black tile and cream page as
the rest of Kernl.
