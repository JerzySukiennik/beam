# Beam

A projection-mapping game and sandbox. Point a projector at a real wall, trace what hangs on it (frames, shelves, lamps), and those objects become neon platforms, water, lava, bouncers and lucky blocks for small characters to run and jump across.

It works two ways. With a real projector over HDMI, you calibrate and draw straight on the wall. Without one, a wall photo stands in for the room and a simulated beam lights it, so you can see how the mapping lands on real objects.

Phones join by scanning a QR code. Each one becomes a gamepad for its own character (up to 8 at once), or a touch editor of the wall, where you can trace objects on a photo taken with the phone.

## Run

Any static server works. There is no build step.

```bash
python3 -m http.server 8981
```

Then open http://localhost:8981.

While changing the code, run `python3 Niepotrzebne/devserver.py` instead. It serves the same files with caching turned off, so a reload always picks up edited modules.

## Steps

1. **Ściana** (wall): start on a real wall, or pick a wall photo or upload your own.
2. **Projektor**: open the projector window (real wall), or mark where the projector's light lands on the photo. Presets cover a projector in front, to the side or below.
3. **Kalibracja**: line four crosshairs up with the corners of something whose size you know, and type the size in cm. From then on everything is measured in real centimetres, so the character keeps its size whatever the projector angle.
4. **Mapowanie** (mapping): draw shapes over the objects and give each one a type.
5. **Gra** (play): run around on it.

Each photo wall has a ready demo level. The **Demo** button brings it back, and Cmd+Z undoes that.

Light walls, frames and shelves show the projection best. Dark things such as a black laptop or a chair reflect almost none of it, in the preview just as in a real room.

## On a real projector

1. Connect the projector over HDMI. In System Settings, Displays, use it as an extended display, not a mirror.
2. In step 1, click **Zacznij na prawdziwej ścianie** (start on a real wall). A real wall has no photo: the editor shows the projector image itself.
3. In step 2, click **Otwórz okno projektora** (open the projector window). Chrome and Edge ask once for permission to manage windows on all screens, and after that the window lands on the projector by itself. Without that permission, or in another browser, it opens next to the editor and you drag it over.
4. Click the image on the wall to go fullscreen. F toggles it, Esc leaves it. In fullscreen the image follows the projector's resolution, up to 1920 pixels wide.
5. Calibrate on a sheet of A4 (or A3, 30×40 or 50×70 cm) taped to the wall. Drag the crosshairs with the mouse right on the wall. Arrow keys nudge the selected one by a pixel, Shift+arrows by ten.
6. Draw the shapes on the wall the same way. The cursor turns into a crosshair in the projected image.

The projector panel also has:

- **Obraz testowy** (test pattern) for focus and keystone.
- **Odbij w poziomie / w pionie** (flip) for a projector on the ceiling or behind a screen. The browser remembers it.
- **Światło robocze** (work light): a grey wash in steps 2 to 4, so the wall and what hangs on it stay visible in a dark room. It is off in play.

Shapes are stored in centimetres from the calibration sheet, so **Skopiuj kształty z innej ściany** (copy shapes from another wall) lines them up when both walls were calibrated on the same sheet.

In play the game runs on the projector and the keyboard works in both windows. If the editor's screen goes blank when the projector goes fullscreen, turn on "Displays have separate Spaces" in System Settings, Desktop & Dock.

## Phones

On a real wall the room for phones opens by itself from step 4 on. Anywhere else, click **Telefony** at the top right, or **Otwórz pokój dla telefonów** in the side panel of steps 4 and 5. The room has a 4-letter code and a QR code that opens `pad.html` with the code filled in. In steps 4 and 5 the same QR code also sits on the wall, as a white card in a corner of the image (**Kod QR na ścianie** turns it off, **Róg** picks the corner).

On the phone, type a name, pick a colour and tap **Dołącz** (join). The phone has two tabs:

- **Pad**: big buttons for left, right and down, **Skok** (jump), and **Chwyć** (grab) in rubbery mode. The character on the wall has the phone's colour. Landscape is the most comfortable, and a laptop can join too and play on its keyboard.
- **Ściana** (wall): a touch editor. **Prostokąt** draws a rectangle with a diagonal drag, **Wielokąt** places corners one tap at a time (tap the first point to close), **Wybierz** selects and moves shapes and items. The type button changes the type of the selected shape, or of the next one. Two fingers zoom and pan.

On a real wall, **Zdjęcie ściany** (photo of the wall) turns the projector image into flat grey light with four coloured markers. Take a photo that shows all four: the phone finds them, you check or nudge them with a loupe, and from then on you trace objects right on the photo and every shape lands on the real thing. The phone keeps the photo for that wall. On a photo wall the editor shows that same photo, sent from the computer.

The panel on the computer lists who is connected and how (directly or through the server), and the **×** next to a name disconnects that phone. Keyboard players (none, 1 or 2) play alongside the phones, so a game can be phones only.

### Component types

| Type | What it does |
|---|---|
| Solid | Walls and floors |
| Platform | One-way: jump up through it, Down drops through |
| Water | Swim; jump out at the surface |
| Lava | Respawn on touch |
| Ice | Slippery |
| Bounce | Springs the character up |
| Lucky block | Hit from below for a coin, mushroom, feather or star |
| Screen | Animated picture inside a frame (plasma, tunnel, space, fire, waves, or an image from disk) |
| Mask | Blacks the light out, e.g. over a TV or a face |

Shapes combine with booleans (union, subtract, intersect), so a frame is a rectangle with a rectangle cut out of it.

### Movement

- **Precyzyjny** (precise): tight platformer controls with coyote time, jump buffering and variable jump height.
- **Gumowy** (rubbery): a physics ragdoll that wobbles, falls over and can grab ledges.

## Controls

| Keys | Action |
|---|---|
| ← → | Run |
| Space or ↑ | Jump (hold for higher), swim |
| ↓ | Drop through a platform |
| Shift | Grab (rubbery mode) |
| R | Restart (in play) |
| F | Fullscreen (in the projector window: the projector's fullscreen) |
| 0 | Fit view |
| Cmd+Z, Cmd+Shift+Z | Undo, redo |

With two keyboard players, player 1 uses the arrows (grab: Enter or right Shift) and player 2 uses W A S D (jump: W or Space, grab: E or Q).

Editor tools: V select, A points, Q corners, R rectangle, O ellipse, P polygon, B brush, L line, E eraser, G bucket, I items.

## Under the hood

- **Spaces.** There are three coordinate spaces: photo pixels, projector pixels and wall centimetres. They are tied together by homographies from the projector quad and the 4-point calibration. On a real wall there is no photo, so photo space is the projector image itself.
- **Rendering.** The game renders straight into projector space with three.js: the camera projection is the wall-to-projector homography. UnrealBloom provides the neon glow. Characters are drawn after the bloom, so they keep crisp lines with only their own glow.
- **Projector window.** `projector.html` is a same-origin popup. The editor creates a second WebGL context on its canvas that shares the scenes, camera and materials, so both windows draw one game state, each with its own bloom pipeline. The popup's animation frames drive the loop while it is visible, and in play the editor redraws only every third frame. The window finds its way onto the HDMI screen through the Window Management API.
- **Rooms.** The editor is the host and keeps the only copy of the scene. Phones talk to it over WebRTC data channels: a reliable one for events and edits, and an unordered one without retransmits for buttons, sent about 20 times a second. Signalling goes through Firebase Realtime Database (project `beam-gzowo`). If a direct link does not come up within 6 seconds, the phone falls back to a relay through the database, and later climbs back to WebRTC on its own. The editor claims the room code with a transaction, the database removes it when the editor disconnects, and a reload of the same tab reclaims the same code, so phones reconnect by themselves. Edits from a phone mid-game rebuild the level's colliders in place, without a respawn. With `?net=local` the room runs over a BroadcastChannel inside one browser, which the tests use.
- **Photo matching.** The four markers sit at known projector pixels. The phone finds them by hue in a downscaled copy of the photo, and four point pairs give a photo-to-projector homography. Chained with the calibration, it maps centimetres onto the photo. Only that homography is stored, so a new calibration does not need a new photo; moving the projector does.
- **Physics.** Rapier 2D works in centimetres. The precise mode uses a kinematic character controller and the rubbery mode uses a jointed ragdoll.
- **Rendering on demand.** The editor and calibration screens redraw only when something changes. The game loop runs only in step 5. The phone editor also draws only on change.
- **Storage.** Scenes save to localStorage per wall, and uploaded photos go to IndexedDB.

These libraries load from a CDN: three.js 0.170.0, @dimforge/rapier2d-compat 0.14.0, clipper-lib 6.4.2, qrcode-generator 1.4.4 and the Firebase JS SDK 10.12.5.

The database rules live in `rules/database.rules.json`: anyone can use a room whose code they know, nobody can list rooms, and every field is checked for shape and size. Deploy them with `firebase deploy --only database --project beam-gzowo`.

## Tests

Headless checks in `Niepotrzebne/tools` run against a local server on port 8981 (Chrome and playwright-core):

- `test-projector.mjs`: the projector window, calibration and drawing on the wall, play.
- `test-phones.mjs`: joining, pad buttons, wall edits from the phone, marker detection on a real projector frame, kick and reconnect. `NET=rtc` runs it on Firebase and WebRTC, with a second phone forced onto the relay.

## Not here yet

- Sound
- More game modes and characters
- "When → do" rules
- Templates
- The AI level proposer
- Govee light sync

## Wall photos

- `biurko.jpg`: Franco Debartolo, [Unsplash](https://unsplash.com/photos/P-6ck1BK8Wc), Unsplash License
- `galeria.jpg`: Jonny Caspari, [Unsplash](https://unsplash.com/photos/KuudDjBHIlA), Unsplash License
- `pokoj.jpg`: our own photo
