# Worldbuilder

A browser scene studio for building sets, performing characters, and filming the
same performance from different cameras. Three.js, local assets, no build step.
The scene timeline combines layered character performances and an editable camera track. The AI prompt layer is future work.

## Run

```sh
npm ci
npm start
```

Open **http://localhost:8648**. This is the fixed Worldbuilder port; do not start
additional copies on another port. On Bugsy, use **http://192.168.1.185:8648**
while connected to the iMac's network. The active server serves the
`/Users/sami/codex/world-builder-live` symlink, so a new checkout can be selected
without changing the browser address. Stop the existing server before restarting
it; `npm start` also uses 8648.

Use a desktop browser with WebGL and MediaRecorder (Chrome/Edge recommended).
Library and Direct the action share the right sidebar. Movement uses a keyboard.

## Layer performances, then film from anywhere

1. Open **Library → Characters** and add a character, or use the existing Vale.
   Importing models and adding characters work while the timeline is paused or
   playing. Playback pauses at the current frame; existing layers and the playhead
   stay intact. There is no need to switch Back to live. Finish an active movement
   recording or video export before adding characters.
2. Select the character and click **Control character**. WASD moves, Shift runs,
   right-drag turns the view. The Animation menu plays the model's clips; movement
   returns it to locomotion. **Camera / Character** at the top chooses what your controls drive. Picking a
   viewpoint never changes that mode: you can perform through Crane, Dolly, Close-Up,
   a saved camera, or Free. The adjacent character dropdown chooses your performer.
   In Camera mode, **Free** (or F / 0) is a flying editor camera; Space / C change height. Flying in Camera mode does not move a placed camera or character. Once directed, a character remains at rest rather than resuming its
   demonstration patrol.
3. Place the shared playhead where you want the performance to begin. Click
   **Record movement**, perform, then **Stop movement**. Only the selected character
   is recorded, at 60 simulation samples per second. Recording automatically enables
   Character control without changing your camera.
4. **Rewind**, choose another character in the top dropdown, and record again.
   Existing layers play in sync while you perform the new character. New recordings
   appear on separate timeline rows; the earlier recordings stay intact.
5. Drag a clip to change its start time, or drag either edge to trim it. Dragging
   snaps to tenths of a second; hold Alt for fine timing. The inspector also offers
   a name, start time, and source trim-in/out values in seconds. Trimming is
   non-destructive. **M** mutes a layer, **×** deletes it, and undo restores edits.
6. Scrub or play the combined scene. All layers share the same clock, including
   animation poses, rain, and lamp flicker. Use the ruler, scrubber, horizontal
   scroll, and Zoom control to work with longer scenes. Playback stops at the end
   of the last camera or movement clip; empty tracks cannot play.
   To split a camera or movement clip, select it, place the playhead inside it,
   and press **Split** (or **Cmd/Ctrl B**). Both pieces retain their timing and
   recorded poses; later clips stay in place. Undo joins the pieces again.
7. The blue **camera track** sits above the performances. Click an angle to
   choose its camera in the inspector. Change its start and length, or choose an
   incoming **None**, **Fade**, or **Wipe** transition and effect duration. Drag
   an angle or its edge to move/resize it without overlapping another angle.
8. Choose a camera above the viewport, set the **Length** next to **Record Camera Angle**,
   and press that button to insert the current view at the playhead. Or drag a
   camera above the viewport (including Free) directly into the camera track. The default
   length is three seconds. Inserting shifts later camera angles to the right;
   character performances retain their original timing. Inserting in the middle
   of an angle asks **Split camera angle?** before keeping both original pieces
   around the new angle. Cancel or Escape leaves the edit unchanged. Undo reverses
   the entire insertion, split and timing shift in one action.
9. Remove an angle with its **×**, the inspector's **Delete**, or the Delete key
   after selecting it. Later camera angles close the gap. The last angle can also
   be deleted; the empty track explains how to add one again. **Use current view**
   replaces the selected angle without inserting time. **Adjust angle** lets you
   aim it with right-drag or Q/E. **Camera edit** returns from scouting to timeline
   playback. Gaps in the camera track render black; export requires at least one
   angle. **Scene end** changes the final camera angle's length; performance
   layers still determine the minimum scene end. Camera-only scenes initially
   start at ten seconds, and trimming or deleting clips updates the playback end.
10. **Export video** opens settings for **MP4** or **WebM** and quality:
    **720p**, **1080p**, or **1440p** at 30 fps. The selected quality controls
    resolution and bitrate. Press **Export video** in the dialog to render
    the entire composition from zero, including
    every enabled performance and the camera transitions. The exported image
    matches the visible 3D frame, including Dolly tracking and framing.
    Choose **Video frame** in **Direct the action** or the export dialog for
    **Landscape · 16:9** (default) or **Vertical · 9:16**. The viewport shows
    the complete frame with letterboxing, and changing it supports Undo/Redo.
    Vertical resolutions are 720 × 1280, 1080 × 1920, and 1440 × 2560.
    A file format is disabled when the browser cannot encode it.
    The preview opens when ready, with **Download video** and a top-right **×** (or Escape) to close it.
    **Cancel export** discards an unfinished video. **Download scene** packages
    scene data, assets, camera edits and completed videos into a ZIP.

Clips for different characters play together. If clips overlap on the **same**
character, the most recently recorded clip wins within its span. Before a character's
first clip it holds that clip's starting pose; gaps and the time after its last clip
hold the preceding final pose. Muted clips do not drive characters. Characters with
no enabled clips hold their baseline pose. Record until the character settles if
you want a resting end pose.

Right-click empty space (or middle-click) and choose **Camera** to start placement.
Move it onto the set, use Q/E to turn it (Shift for finer steps), scroll to adjust
height, then click to confirm. Escape
cancels. Moving a placed camera preserves its viewing angle.

The camera choices and Camera/Character control sit together above the viewport.
**Library** and **Direct the action** are tabs in the right sidebar; the library
shows three columns of assets. **Download scene** is in Direct the action.

In replay, **Free camera** lets WASD/right-drag scout a new angle without moving the recorded characters. Dolly
and Close-Up follow the selected cast member. Camera-track shots retain their chosen
character target independently of later cast selection. Export always follows the camera track.

Choose **Camera** control, look through a placed camera, and right-drag (or left-drag empty space) to pan and
tilt it on its fixed position. Q/E also rotates the selected/viewed camera. Aiming
a tracking camera pins its current position and turns it into a static camera;
Undo restores the tracking behavior. WASD never translates a placed camera. In **Character** control, WASD and Shift
move/run the selected performer and right-drag steers them while the chosen shot
stays selected. Character view follows the performer; other camera views retain
their normal fixed or tracking behavior. Camera mode lets you frame the shot
without driving the character. Returning to Character mode preserves that shot.
Right-click a camera model **or its view button** and choose **Delete camera**.
Deleting the active camera returns to Free view. Character and Free are navigation
views, not removable scene cameras.

## Undo and redo

Use the Undo/Redo buttons beside **Back to live** in the timeline, **Cmd/Ctrl Z**, **Cmd/Ctrl Shift Z**, or **Ctrl Y**. The
session keeps the latest 80 edit transactions. Whole drags and movement sequences
are single actions. History covers object placement/movement/rotation/elevation/
deletion, camera creation/aiming/movement/deletion, character additions and player
movement, animation changes, model imports, grid snapping, movement recordings,
clip offsets/trims/names/muting/deletion, camera cuts, shot angles, transitions and scene length. Redo is cleared by a new edit. Undo during placement
cancels that placement. Stop recording or finish loading a model before undoing.

View selection, timeline scrubbing, and free-camera navigation are navigation,
not scene edits. Text inputs retain their usual native undo behavior. History is
session-local and does not undo files already downloaded to disk.

Each recording adds a layer to the same scene. Selecting a layer changes the
inspector, without changing playback or jumping the playhead. Props and cameras
belong to the shared scene. **Back to live** resumes building and character setup;
it preserves the playhead so the next recording starts there. Use **Rewind** to
record from zero. The scene timeline is limited to five minutes.

## Assets

The searchable library includes nineteen editable set props, a skinned humanoid with a
walk cycle, and a robot with fourteen clips. These are starter assets, not
photorealistic humans. [Model credits](assets/ATTRIBUTION.md).

**Import .glb** imports into the selected library category. Imported characters
use their own skeleton and embedded animation clips. Clip names containing
Idle/Standing, Walk, and Run select automatic locomotion; other clips are available
in the Animation menu. A character without an idle clip gets a neutral pose averaged over its walk cycle
with gentle breathing. Idle/walk/run transitions blend over 220 ms, movement
accelerates and brakes, and turning has a bounded angular speed. The recorded
performance includes animation weights and times so blends rewind accurately. A
model without skeletal animation can still move as a static character. Characters normalize to
1.85 m tall; props normalize to 1.2 m. Imported props have bounding-box collisions.
Use self-contained GLB files up to 50 MB. Separate textures, FBX, Draco/KTX2
compression and animation retargeting are not supported in this prototype.

## Controls

| Input | Action |
|---|---|
| WASD / Shift | Accelerate / run controlled character, or fly Free view |
| Space / C | Move Free view up / down |
| F / 0 | Independent Free view |
| Right-drag | Look / steer movement, or aim a pinned camera |
| Right-click camera or view button | Camera deletion menu |
| Left-drag prop | Move it (red placement is denied) |
| Middle-click | Context placement menu |
| Q / E (+ Shift) | Rotate selected prop or camera (15° / 5°) |
| Scroll over viewport | Raise/lower selected prop or camera |
| G | Toggle grid snapping |
| Delete | Remove selected prop or camera |
| Cmd/Ctrl Z / Cmd/Ctrl Shift Z | Undo / redo scene edits |
| Escape | Cancel placement / deselect |
| 1–9 | Select character/camera view |
| R | Export video / cancel export |

Props cannot be edited during movement recording or replay; return to live first.
Camera aiming and placement remain available during paused/playing replay, but are
locked while capturing video or recording movement. Scouting camera switches are locked during video export.
Typing into the library search or a dropdown does not trigger movement shortcuts.

## Export and limitations

ZIP contains `footage/`, `manifest.json` (completed videos), `cameras.json` (shots/transitions), `scene.json`,
`performances.json` (actor tracks), and bundled/imported GLB assets with model credits. Videos contain only the
3D canvas, with no editor overlays or audio. WebM is used when supported; MP4 is a
browser-dependent fallback. Rendering is real time, not an offline frame renderer:
slow devices may produce dropped video frames. Export uses memory proportional to
completed videos, so keep sessions short and download videos when needed.

Sessions currently live in memory. Export before refreshing or closing. JSON is a
foundation for future project saving/loading; this version has no project importer,
no AI service, no multiplayer, no audio, and no imported-video editing. One player
controls one actor at a time; other actors can follow paths or play animations.
Collision remains simple bounding boxes, not a physics engine.

## Verify

```sh
npx playwright install chromium   # once, if needed
npm run verify                   # against localhost:8648
# alternate running server:
WORLD_BUILDER_URL=http://localhost:8648 npm run verify
```

Assertions cover placement/denial/cancel, character loading/import, player movement,
recorded locomotion and gestures, exact backwards bone-pose seeking (including blended transitions), gradual turns
and complete idle settling, camera placement/aiming/deletion, undo/redo, alternate camera
captures, video decoding, ZIP contents, layered playback/editing, and narrow-window
cast access. Screenshots are written to ignored `shots/`.

### Layered timeline verification

`npm run verify:timeline` covers synchronized overdubbing, exact pose rewind across
cameras, clip offsets and trims, muting, deletion, mouse dragging, undo/redo, combined
camera capture, and version-2 export. `performance.test.mjs` also checks overlap
priority, held poses in gaps, time bounds, and immutable recorded frames.

The export's `performances.json` version 2 includes the shared baseline, scene
duration, and each clip's character names, start, trim points, mute state, and frame
data. Exported videos snapshot their composition and camera metadata. Project re-import, audio
tracks and arbitrary property keyframes are not implemented yet.

`npm run verify:playback-framing` checks playback endings, an empty timeline,
camera/movement splitting with exact pose replay and undo/redo, viewport sizing,
and the decoded Dolly video against the timeline preview.
`npm run verify:export-settings` checks MP4/WebM signatures and decoded
resolution, all three quality choices, vertical and landscape framing,
settings cancellation, frame undo/redo, and the narrow export dialog.

### Wall placement

Drag a floor prop over an alley wall to place its visible mesh edge against it.
With snapping enabled, nearby floor placement also snaps flush. Rotating a flush
prop keeps it against the wall. Library neon signs mount directly onto a wall at
the cursor height. The wall contact uses a 1 mm separation to prevent surface
flicker; character collision padding no longer forces a visible gap for props.

`npm run verify:cameras` checks camera timing, transitions with actual GPU pixels,
shot-angle undo, video decoding/download, cancellation and exported camera metadata.
`npm run verify:walls` checks wall contact, rotation and undo using rendered mesh bounds.

On slower hosts, browser checks accept `WORLD_BUILDER_TEST_DPR=0.25` to reduce render resolution while retaining the same UI layout and interactions.

`npm run verify:camera-clips` checks camera replacement, deleting the last angle,
ripple insertion, confirmed/cancelled splits, direct top-bar drag/drop, undo/redo
and preservation of performance timing.
