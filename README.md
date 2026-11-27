# JARVIS

**JSON Arrow Reference & Visualization Interface Studio** is a standalone browser-based tool for placing 3D arrow references on engineering models and exporting those transforms into the existing McDermott SOP workflow JSON format.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. From this directory, run `npm install`.
3. Run `npm run dev` and open the local URL Vite prints.
4. Open a workflow JSON with the existing `sop[].steps[]` structure, or import an `.xlsx` file, then load a model.

The app runs locally in the browser. Workflow files and models are not uploaded to a server. Supported model formats are FBX, GLB, GLTF, OBJ, and STL. For models with external textures, select the model and its companion resource files together in the file picker. OBJ materials are loaded when a matching MTL file is selected.

## Place and export arrows

1. Choose a scene step in the left workflow list. Existing `animationIndicator` arrows are loaded into the viewport.
2. Select **Place arrow on model**, then left-click a point on the model. Repeat for as many arrows as the step needs.
3. Use **Next Arrow Color** to choose the JARVIS-only color used by subsequently placed arrows, or select an existing arrow to change its color. The selected arrow is highlighted; arrow colors are not included in exported JSON.
4. Select **Preview** to inspect the step while the arrows slide along their pointing direction. Preview keeps the camera controls active: right-drag to orbit, middle-drag to pan, scroll to zoom, or use the axis gizmo and **Unity Front** selector to change views.
5. Select **Export JSON** to download the workflow JSON. Excel imports use `workflow_<scenario>.json` (for example, selecting **CIP** exports `workflow_CIP.json`); JSON imports keep their original base filename. CIP exports convert arrow positions from FBX centimeters/model-root space to Unity controller-local meters and account for the Unity arrow prefab tip offset. Other workflows retain their original coordinate convention.

For Excel import, choose a scenario column from the visible **SOP Comparison** worksheet. Each non-empty cell under a **Sequence Name** becomes a numbered step in that sequence; the workbook text is retained in the generated workflow fields (`sequenceId`, `stepNo`, `title`, and `instruction`). This creates the app's workflow JSON in-browser without needing the proprietary source JSON.

Use **Unity Front** to select the camera axis that matches the loaded model, then select **Reset view** to return to it. **Auto** points the camera along the model's longer horizontal axis; the gizmo also snaps to +Z, -Z, +X, -X, +Y, and -Y. Right-drag to orbit, middle-drag to pan, and scroll to zoom; left-click selects or places arrows. The hover marker is a small depth-tested surface decal. Camera changes do not modify model transforms or component values.

The viewport uses stronger neutral ambient and directional lighting to brighten dark models without changing their materials or transforms. New arrows use the default Unity-reference scale `(-6.32600021, 6.32600021, 6.32600021)`, point perpendicular to the clicked surface, and keep their tip slightly clear of the clicked surface. Preview motion moves the arrow outward from the model to avoid penetrating it. Arrow colors remain in JARVIS for the current browser session and are not exported. Exported transforms retain the workflow's standard position/rotation/scale shape. The app does not modify the source files.
