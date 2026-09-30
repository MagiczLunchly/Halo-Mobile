# Halo Mobile

Halo Mobile is a browser-first port of the Halo: Combat Evolved decompilation. It runs as an installable web app on current Android, iPhone, iPad, and desktop browsers.

This repository provides the mobile web build, a direct Play launcher, touch and controller controls, saved games in browser storage, streamed-map support, and System Link matchmaking.

> **No game data is included.** This repository does not contain, download, or redistribute Halo maps, disc images, saves, or other proprietary game data. Supply compatible game data from a source you are authorized to use.

Halo Mobile is an unofficial fan project. It is not affiliated with or endorsed by Microsoft.

## Features

- Open directly to the launcher and use **Play** or **Play streamed maps** at the top.
- Install as a full-screen progressive web app.
- Use touch controls, Bluetooth or USB controllers, or keyboard and mouse.
- Keep game data, saves, configuration, and shader caches in Origin Private File System storage.
- Import a disc image or maps folder privately into the browser.
- Stream maps from a separately hosted range-request endpoint instead of importing all map files.
- Host or join Halo System Link games through the launcher.
- Use default bounded readback presentation or experimental direct worker-canvas presentation with the presentation query parameter.

## Requirements

### Play

- A current browser with WebGL 2, OffscreenCanvas, SharedArrayBuffer, and OPFS.
- Android Chrome, iOS or iPadOS 17 or later, or a current desktop browser.
- Approximately 2 GB of browser storage for a full local map import.
- Compatible Halo game data that you are authorized to use.

Use HTTPS for phones on a network. Localhost is suitable for local development and Android ADB reverse testing.

### Build

- Python 3.10 or later.
- Ninja.
- Emscripten 6.0.10.
- Network access for the first build, which obtains build dependencies.

## Build the web app

    git clone https://github.com/OMG-Guest/Halo-Mobile.git
    cd Halo-Mobile

    git clone --depth 1 https://github.com/emscripten-core/emsdk.git ../emsdk
    python3 ../emsdk/emsdk.py install 6.0.10
    python3 ../emsdk/emsdk.py activate 6.0.10
    source ../emsdk/emsdk_env.sh

    python3 configure.py --release
    ninja web
    node --test port/web/tests/*.cjs

The browser app is written to build/web/site.

## Run locally

Serve build/web/site with a server that preserves byte ranges for maps and provides cross-origin isolation. For a basic local check:

    python3 -m http.server --directory build/web/site 8081

Open http://localhost:8081. The service worker reloads once to establish isolation.

For Android USB testing:

    adb reverse tcp:8081 tcp:8081

Then open http://localhost:8081 in Chrome on the device. Do not use an insecure LAN HTTP address for full mobile functionality; deploy HTTPS instead.

## Add game data

Choose one path from the launcher:

1. **Choose disc image**: import an authorized ISO or XISO; Halo Mobile extracts and retains only its maps in private browser storage.
2. **Import maps folder**: select an extracted compatible maps directory.
3. **Play streamed maps**: configure a separate downloaded-maps manifest plus HTTP byte-range endpoints, then retain that server connection while playing.

Map data is intentionally ignored by Git. Do not commit game data, saves, credentials, or generated build output.

## Presentation modes

The normal mode uses bounded readback to keep browser graphics allocation stable.

Add the presentation query parameter with the direct value to use experimental direct canvas presentation. It avoids per-frame readback and can feel smoother on tested Android hardware, but it remains opt-in while more device and long-session tests are completed.

## Project layout

- port/web/site/: launcher, UI, service worker, controls, and browser runtime.
- port/web/src/: Emscripten and Web platform bridge.
- port/web/tests/: Node tests for launcher, presenter, and streamed-map behavior.
- source/: Halo decompilation source.
- tools/web_build.py: Ninja build graph for the browser port.

## Attribution and licenses

This project builds on https://github.com/fucktrevor/HCE-Mobile, https://github.com/cybersecurity/halo-ce-universal, https://github.com/bnunu/halo-1, and https://github.com/punpckhdq/halo. Preserve their attribution and the repository licenses when redistributing or modifying this source.

Read LICENSE.md and the license notices in included components.
