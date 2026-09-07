# Exploring Rome in 3D, and putting proposed road changes into it

## What the Sydney demo actually is

The post describes a whole city turned into a navigable 3D model over a Saturday
afternoon: map plus real photos in, Blender for the detailed models, Three.js for the
interactive view, day/night toggle, "street proportions and building materials
practically perfect".

That is a real and impressive thing to build, and it is worth being precise about what
it is, because the difference matters for what you want to do with it.

A city built this way is a **plausible** city. Building masses come from footprints with
estimated heights, facades are textured to look right, and the landmarks that people
recognise — the Opera House, the Harbour Bridge — are modelled by hand because they are
what sells the shot. It reads as Sydney because the skyline, the landmarks and the
street pattern are right. Nothing in the pipeline measures anything. "Street proportions
practically perfect" means they look convincing, not that a carriageway is 11.50 m wide
because someone surveyed it at 11.50 m.

For urban exploration, a portfolio piece or an architectural fly-through, that is
entirely sufficient and the result is genuinely striking.

For your objective it is a liability, and specifically at the moment it succeeds. If you
show a road safety proposal on a model like this, the first technical question in the
room is *how wide is that carriageway now, and how wide are you making it* — and the
honest answer would be that the model does not know. A proposal that looks convincing
and cannot answer that question is worse than a plan drawing that looks dull and can.

So the target is not "a beautiful 3D Rome". It is **a beautiful 3D Rome with one
measured hole in it**.

## The accuracy contract

The approach that resolves this is to build the scene in two zones and never let them
blur:

| | Context zone | Intervention zone |
|---|---|---|
| What it is | Streamed photogrammetric city | Geometry you authored |
| Where it comes from | Google Photorealistic 3D Tiles | Survey, DBGT, LiDAR, CAD |
| What it is for | Orientation, recognition, the sense of being there | The proposal itself |
| Dimensional claim | **None.** Nothing is measured off it | Every dimension is a number someone chose and can defend |

The mechanism that lets both live in one scene is a **clipping polygon**: the
photorealistic tileset is cut away over the intervention area and replaced with your own
surface and design. This is not a workaround; it is what the feature was built for, and
Cesium's own tutorial for it uses insetting a proposed roadway design into Google's
tiles as the worked example.

The clip does two things at once. Visually it removes the old kerb lines and road
markings that would otherwise show through the new ones. Methodologically it draws a
literal, visible boundary around the part of the scene that carries a dimensional claim.
In the prototype that boundary is the dashed yellow line, and it is deliberately always
visible.

That boundary is the part of this worth insisting on. It is what lets you put something
genuinely persuasive in front of the Dipartimento without the persuasion resting on
anything you cannot substantiate.

## Recommended stack

**CesiumJS in the browser, with Blender for bespoke models.**

Three reasons to prefer Cesium over Three.js, which is what the Sydney demo used:

1. **It is georeferenced.** Cesium knows about the ellipsoid and real coordinates. You
   place an object at a coordinate and it lands there. In Three.js there is no geodesy
   at all — you would hand-roll the projection maths, and the CRS discipline that your
   work depends on would be reimplemented from scratch by you, in a browser, with no
   check on it. Cesium is Three.js-grade WebGL underneath; the difference is that it
   understands the Earth.
2. **It is where the photorealistic tiles and the clipping already work.** 3D Tiles is
   Cesium's format. The inset workflow is a documented, supported path.
3. **It runs in a browser.** No installation, so no admin rights, which settles the work
   PC constraint outright. Colleagues open a link or a folder.

**Blender: yes, for the design objects, not for the city.** This is the correction to
the Sydney recipe. Do not model Rome in Blender. Model the things that do not exist yet
and cannot be described parametrically — a redesigned junction, a specific shelter, a
signalised crossing with real geometry — and export them as glTF/GLB. Blender runs
portable from a ZIP, so it is already compatible with your machine. The
Blender → glTF → Cesium path is well-trodden and does not lose scale.

**Unity: I would not.** It needs installation, an account and a licence, it produces a
build your colleagues cannot easily open on locked-down machines, and it buys you very
little here. Cesium for Unity exists and works, but the cost/benefit is poor for this
purpose. Unreal plus Cesium is what the cinematic versions of this are made with; it is
the right answer only if you specifically need a rendered video for a public
consultation, and it needs a GPU workstation.

## Three levels, and which one to pick

**Level 1 — QGIS 3D view / Qgis2threejs.** Extrude DBGT footprints, drop the proposal in
as a layer. Zero new tooling, zero cost, everything stays in software you already have.
Good enough for internal technical review. It will not impress anyone and it is not
meant to.

**Level 2 — this repository: standalone HTML plus CesiumJS.** Photorealistic context,
clipped intervention zone, parametric safety elements, Blender models where needed,
before/after and day/night toggles, GeoJSON and CSV exports. Runs from a folder over a
local Python web server, shareable as a zipped directory or an internal URL. **This is
the recommendation.**

**Level 3 — Unreal or Unity with Cesium.** Cinematic quality, rendered video, VR. Only
if a specific public-facing deliverable demands it, and treat it as a separate project
with a separate budget.

Level 2 is the minimum that actually meets the objective, which is the level to build.

## Data for the intervention zone

The context zone needs nothing from you. The intervention zone is where your existing
data holdings become the real advantage, and they are considerable:

- **DBGT Lazio (EPSG:25833)** — building footprints, kerb lines, road edges. The base for
  an accurate existing layout.
- **LiDAR / point clouds** — the strongest source for an as-built cross-section: real
  kerb heights, real crossfall, real carriageway width. Convert to 3D Tiles with
  `py3dtiles` (`pip install --user py3dtiles[las]`) and it streams into the same scene.
- **DWG survey and design files** — via `ezdxf`, already in your stack. This is where a
  design that has actually been drawn comes from.
- **Google Photorealistic 3D Tiles** — context only, over 2,500 cities including Rome.

One CRS note carried over from how the rest of your pipelines are built: the design in
this prototype is authored in a **local East-North-Up frame in metres**, anchored to one
origin, and transformed to the globe exactly once at render time. Elements are placed by
chainage and offset rather than by longitude and latitude. That keeps a single
reprojection at the boundary instead of a chain of them, and it means the design is
dimensioned the way it is drawn and reviewed. `EPSG:4326` appears only on the way out, in
the GeoJSON export.

## Bringing Blender work in

The convention the prototype uses, so that a model lands correctly with no manual
alignment:

- Author in **metres**, at real scale.
- Put the model's **origin where it should sit on the ground**.
- Point **+Y forward**, along the direction of travel.
- Export **glTF 2.0 (.glb)**, Y-up.
- Add an entry to `app/src/config.js` with `type: "model"`, a `station` and `offset`, and
  the file path. It is placed and rotated to the corridor automatically.

There is a disabled example slot in the config showing the shape of this.

## Cost and licensing

- **Cesium ion** has a free tier, and Google Photorealistic 3D Tiles are included with an
  ion account. This matters practically: it means **no Google Cloud billing account is
  needed**, which is usually the step that stalls inside a public administration.
- Going direct to Google instead: 1,000 free requests per month, then $6 per thousand.
  The billable event is the root tileset request, roughly one per session rather than one
  per tile, so internal use sits comfortably inside the free allowance.
- **Attribution is mandatory** — the Google and Cesium credit line must stay visible.
  The prototype keeps it, and the CSS explicitly protects it.
- **You cannot export or cache Google's tiles.** They are streamed, always. Anything you
  need to keep, print or hand over must come from your own geometry — which is another
  reason the intervention zone has to be yours.

## Constraints this respects

- No admin rights: everything is browser-based or portable.
- No Docker, no services, no network openings: served by `python -m http.server`.
- CDNs are commonly blocked on corporate networks, so **CesiumJS is vendored locally**
  rather than loaded from a CDN. `tools/setup_cesium.mjs` fetches it, and the file header
  documents the manual route via the GitHub release ZIP if npm is unavailable.
- Exports in formats your colleagues' tools open: GeoJSON for QGIS, CSV for Excel.

## What is built, and what is not

Built and tested (25 automated checks, headless):

- Corridor frame with chainage/offset placement and millimetre round-tripping
- Existing and proposed cross-sections, generated from configuration
- Parametric elements: raised crossings, kerb build-outs, segregation kerb with bollards,
  planted median
- glTF model slot for Blender exports
- Clipping polygon cutting the intervention zone out of the photorealistic context
- Before/after and day/night toggles, cursor readout in chainage and offset
- GeoJSON and CSV export carrying provenance
- A validator that fails loudly if the cross-section does not tile the corridor

Not built, and deliberately so:

- **The photorealistic context path is untested.** It needs a Cesium ion token, which I do
  not have. The code path is written to the documented API and fails gracefully into
  geometry-only mode, but it has not been run against live tiles. Treat it as unverified
  until you put a token in and look.
- No LiDAR or DBGT ingestion yet — the cross-section is typed into config by hand.
- No junction modelling; the corridor is treated as a straight axis between two points.
- No visibility, sight-line or swept-path analysis.

## The numbers currently in the prototype are not real

This matters more than anything else in this document. The demonstration corridor is
Via dei Fori Imperiali, and:

- The **axis was read off a basemap**, to something like half a metre.
- The **cross-section is not surveyed.** The existing section (18.00 m carriageway, four
  4.50 m lanes) and the proposed one (13.00 m, four 3.25 m lanes, 2.50 m two-way cycle
  track) are standard design values chosen to demonstrate the mechanism, anchored to
  DM 557/1999 art. 7 for cycle track widths and DM 5/11/2001 for lane widths. They are
  not measurements of that street.

The interface states this permanently, in the panel, because a screenshot outlives its
caption. Before any figure from this scene is shown outside a technical review, replace
`corridor.axis` with the surveyed centreline and `crossSection` with the measured
section. Both live in one file and nothing else needs to change.

## Suggested next steps

1. Create a free Cesium ion account, put the token in `config.js`, and confirm the
   photorealistic context and the clip behave against live tiles. This is the one
   unverified assumption in the whole approach, so it is worth settling first.
2. Pick a real corridor with a live safety case and a known cross-section.
3. Replace the axis and section with surveyed values.
4. Add DBGT footprints around the intervention zone, so the clipped area still has
   buildings if the context is unavailable or switched off.
5. Only then consider LiDAR ingestion, and only if the argument needs the real surface.

## A note on sourcing

I could not open the linked post — `x.com` is blocked from this environment — so the
reading of the Sydney demo above is based on your quoted description of it. If it turns
out to be photogrammetry or Gaussian splatting rather than generated models, the specific
critique of "plausible not measured" softens, but the two-zone recommendation does not
change: a captured surface still tells you what is there today, never what you propose to
build, and the intervention still has to be authored geometry.
