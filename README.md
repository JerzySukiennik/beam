# Beam

A projection-mapping game and sandbox. Point a projector at a real wall, trace what hangs on it (frames, shelves, lamps), and those objects become neon platforms, water, lava, bouncers and lucky blocks for a small character to run and jump across.

It works two ways. With a real projector over HDMI, you calibrate and draw straight on the wall. Without one, a wall photo stands in for the room and a simulated beam lights it, so you can see how the mapping lands on real objects.

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

With two players, player 1 uses the arrows (grab: Enter or right Shift) and player 2 uses W A S D (grab: E or Q).

Editor tools: V select, A points, Q corners, R rectangle, O ellipse, P polygon, B brush, L line, E eraser, G bucket, I items.

## Under the hood

- **Spaces.** There are three coordinate spaces: photo pixels, projector pixels and wall centimetres. They are tied together by homographies from the projector quad and the 4-point calibration. On a real wall there is no photo, so photo space is the projector image itself.
- **Rendering.** The game renders straight into projector space with three.js: the camera projection is the wall-to-projector homography. UnrealBloom provides the neon glow. Characters are drawn after the bloom, so they keep crisp lines with only their own glow.
- **Projector window.** `projector.html` is a same-origin popup. The editor creates a second WebGL context on its canvas that shares the scenes, camera and materials, so both windows draw one game state, each with its own bloom pipeline. The popup's animation frames drive the loop while it is visible, and in play the editor redraws only every third frame. The window finds its way onto the HDMI screen through the Window Management API.
- **Physics.** Rapier 2D works in centimetres. The precise mode uses a kinematic character controller and the rubbery mode uses a jointed ragdoll.
- **Rendering on demand.** The editor and calibration screens redraw only when something changes. The game loop runs only in step 5.
- **Storage.** Scenes save to localStorage per wall, and uploaded photos go to IndexedDB.

These libraries load from a CDN: three.js 0.170.0, @dimforge/rapier2d-compat 0.14.0 and clipper-lib 6.4.2.

## Not here yet

- Sound
- Phones as controllers and editors, and multiplayer
- "When → do" rules
- Templates
- The AI level proposer
- Govee light sync

## Wall photos

- `biurko.jpg`: Franco Debartolo, [Unsplash](https://unsplash.com/photos/P-6ck1BK8Wc), Unsplash License
- `galeria.jpg`: Jonny Caspari, [Unsplash](https://unsplash.com/photos/KuudDjBHIlA), Unsplash License
- `pokoj.jpg`: our own photo
