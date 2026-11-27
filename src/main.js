import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import unityArrowUrl from './3D RightArrow.fbx?url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { strFromU8, unzipSync } from 'fflate';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const ui = {
  viewport: $('#viewport'),
  workflowInput: $('#workflow-input'),
  modelInput: $('#model-input'),
  workflowUpload: $('#workflow-upload'),
  modelUpload: $('#model-upload'),
  workflowList: $('#workflow-list'),
  emptyState: $('#empty-state'),
  exportButton: $('#export-button'),
  previewButton: $('#preview-button'),
  placementButton: $('#place-arrow'),
  toast: $('#toast'),
};

const state = {
  workflow: null,
  workflowFile: '',
  workflowExportName: '',
  modelFile: '',
  modelRoot: null,
  currentSceneIndex: -1,
  currentStepIndex: -1,
  currentArrowIndex: -1,
  arrowObjects: [],
  nextArrowColor: '#83f26b',
  pointerColor: '#ffc963',
  unityTransformSteps: new WeakSet(),
  placementMode: false,
  previewMode: false,
  hoveredPoint: null,
  modelSize: 1,
  modelDimensions: new THREE.Vector3(1, 1, 1),
  modelCenter: new THREE.Vector3(),
  frontViewKey: 'front',
  frontAxisAuto: true,
};

const DEFAULT_ARROW_SCALE = Object.freeze({ x: -6.32600021, y: 6.32600021, z: 6.32600021 });
const DEFAULT_ARROW_COLOR = '#83f26b';
const SELECTED_ARROW_COLOR = '#ffae42';
const ARROW_SURFACE_CLEARANCE_FACTOR = 0.015;
const UNITY_MODEL_UNIT_SCALE = 0.01;
const UNITY_ARROW_ANIMATION_TRAVEL = 0.0253; // 3D Arrow.anim local X travel in Unity meters (at scale = 1)
const UNITY_ARROW_ANIMATION_PERIOD = 2 / 3; // 3D Arrow.anim loop duration in seconds
const UNITY_MODEL_ROOT_OFFSET = new THREE.Vector3(0, -0.613, -0.605);
const arrowColorsByStep = new WeakMap();
let unityArrowTemplate = null;
let unityArrowTipLocal = null;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#eef1f4');
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
camera.position.set(4, 3, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
ui.viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.mouseButtons.LEFT = -1;
controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

const viewDirections = {
  front: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), label: 'Z+' },
  back: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), label: 'Z-' },
  right: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), label: 'X+' },
  left: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), label: 'X-' },
  top: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), label: 'Y+' },
  bottom: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), label: 'Y-' },
};

function updateViewGizmo() {
  const direction = camera.position.clone().sub(controls.target).normalize();
  let closestView = null;
  let closestAlignment = 0.96;
  for (const [view, orientation] of Object.entries(viewDirections)) {
    const alignment = direction.dot(orientation.direction);
    if (alignment > closestAlignment) {
      closestView = view;
      closestAlignment = alignment;
    }
  }
  document.querySelectorAll('.gizmo-direction').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === closestView);
  });
  $('#gizmo-view-label').textContent = closestView ? viewDirections[closestView].label : '3D VIEW';
  if (state.previewMode) {
    $('#placement-status').textContent = `${closestView ? viewDirections[closestView].label : '3D'} VIEW · PREVIEW`;
  }
}

function setCameraView(view) {
  const orientation = viewDirections[view];
  if (!orientation) return;
  const target = state.modelRoot ? state.modelCenter : controls.target;
  const distance = Math.max(camera.position.distanceTo(target), state.modelSize * 2, 0.2);
  controls.target.copy(target);
  camera.up.copy(orientation.up);
  camera.position.copy(target).addScaledVector(orientation.direction, distance);
  camera.lookAt(target);
  controls.update();
  updateViewGizmo();
}

controls.addEventListener('change', updateViewGizmo);
document.querySelectorAll('.gizmo-direction').forEach((button) => {
  button.addEventListener('click', () => {
    setCameraView(button.dataset.view);
  });
});
$('#front-axis').addEventListener('change', (event) => {
  if (event.target.value === 'auto') {
    state.frontAxisAuto = true;
    if (state.modelRoot) fitCamera();
    else {
      state.frontViewKey = 'front';
      setCameraView(state.frontViewKey);
    }
    return;
  }
  state.frontAxisAuto = false;
  state.frontViewKey = event.target.value;
  setCameraView(state.frontViewKey);
});

scene.add(new THREE.HemisphereLight(0xf4f7ff, 0xb9c0c8, 4.5));
scene.add(new THREE.AmbientLight(0xffffff, 1.8));
const keyLight = new THREE.DirectionalLight(0xfff4df, 5.0);
keyLight.position.set(4, 7, 5);
scene.add(keyLight, keyLight.target);
const fillLight = new THREE.DirectionalLight(0xe4edff, 3.5);
fillLight.position.set(-5, 2, -4);
scene.add(fillLight, fillLight.target);
const rimLight = new THREE.PointLight(0xd94b3d, 25, 30);
rimLight.position.set(-3, 4, 3);
scene.add(rimLight);

const grid = new THREE.GridHelper(10, 20, 0x66573c, 0x383a3b);
grid.material.transparent = true;
grid.material.opacity = 0.29;
scene.add(grid);
const axes = new THREE.AxesHelper(0.7);
axes.material.transparent = true;
axes.material.opacity = 0.55;
scene.add(axes);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hoverMarker = new THREE.Group();
const hoverMaterial = new THREE.MeshBasicMaterial({
  color: state.pointerColor,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.92,
  depthTest: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
hoverMarker.add(
  new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 32), hoverMaterial),
  new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), hoverMaterial),
);
hoverMarker.visible = false;
hoverMarker.renderOrder = 11;
scene.add(hoverMarker);

let toastTimer;
let previewStarted = 0;
const previewPositions = new Map();
function colorsForStep(step = currentStep()) {
  if (!step) return [];
  let colors = arrowColorsByStep.get(step);
  if (!colors) {
    colors = [];
    arrowColorsByStep.set(step, colors);
  }
  return colors;
}

const formatNumber = (value) => Number.isFinite(value) ? Number(value).toFixed(3) : '0.000';
const sceneTitle = (entry) => entry?.title || `Scene ${entry?.sequenceId ?? ''}`.trim();
const stepLabel = (step) => step.title || step.instruction || `Step ${step.stepNo ?? ''}`.trim();
const currentScene = () => state.workflow?.sop?.[state.currentSceneIndex];
const currentStep = () => currentScene()?.steps?.[state.currentStepIndex];
const currentArrowData = () => {
  const step = currentStep();
  return step?.animationIndicator?.[state.currentArrowIndex] ?? null;
};
const isCipWorkflowName = (name) => /^workflow_CIP(?:$|[\s_-])/i.test(name);

function showToast(message, isError = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', isError);
  ui.toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 3200);
}

function resizeRenderer() {
  const bounds = ui.viewport.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resizeRenderer).observe(ui.viewport);
resizeRenderer();

function fitCamera() {
  if (!state.modelRoot) return;
  const radius = Math.max(state.modelSize * 1.8, 0.1);
  const lightScale = state.modelSize * 1.5;
  if (state.frontAxisAuto) {
    state.frontViewKey = state.modelDimensions.x > state.modelDimensions.z ? 'right' : 'front';
  }
  $('#front-axis').value = state.frontAxisAuto ? 'auto' : state.frontViewKey;
  const frontOrientation = viewDirections[state.frontViewKey];
  controls.target.copy(state.modelCenter);
  camera.up.copy(frontOrientation.up);
  camera.position.copy(state.modelCenter).addScaledVector(frontOrientation.direction, radius * 2.28);
  camera.lookAt(state.modelCenter);
  keyLight.position.copy(state.modelCenter).add(new THREE.Vector3(4, 7, 5).multiplyScalar(lightScale));
  keyLight.target.position.copy(state.modelCenter);
  fillLight.position.copy(state.modelCenter).add(new THREE.Vector3(-5, 2, -4).multiplyScalar(lightScale));
  fillLight.target.position.copy(state.modelCenter);
  rimLight.position.copy(state.modelCenter).add(new THREE.Vector3(-3, 4, 3).multiplyScalar(lightScale));
  rimLight.distance = Math.max(state.modelSize * 8, 30);
  camera.near = Math.max(state.modelSize / 1000, 0.001);
  camera.far = Math.max(state.modelSize * 100, 100);
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(state.modelSize * 0.08, 0.01);
  controls.maxDistance = Math.max(state.modelSize * 30, 10);
  controls.update();
  updateViewGizmo();
  grid.position.set(state.modelCenter.x, state.modelCenter.y - state.modelSize * 0.55, state.modelCenter.z);
  grid.scale.setScalar(Math.max(state.modelSize * 0.5, 0.1));
  axes.position.copy(state.modelCenter);
  axes.scale.setScalar(Math.max(state.modelSize, 0.1));
}

function getArrowTipPosition(root) {
  const rootInverse = root.matrixWorld.clone().invert();
  const vertex = new THREE.Vector3();
  let tip = null;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index)
        .applyMatrix4(object.matrixWorld)
        .applyMatrix4(rootInverse);
      if (!tip || vertex.x > tip.x) tip = vertex.clone();
    }
  });
  if (!tip) throw new Error('The Unity arrow FBX contains no mesh vertices.');
  return tip;
}

new FBXLoader().loadAsync(unityArrowUrl).then((fbxModel) => {
  const arrowMesh = fbxModel.getObjectByName('Arrow');
  if (!arrowMesh?.isMesh) {
    throw new Error('The Unity arrow FBX is missing its imported Arrow mesh root.');
  }
  arrowMesh.position.set(0, 0, 0);
  arrowMesh.rotation.set(0, 0, 0);
  arrowMesh.scale.set(1, 1, 1);
  const template = new THREE.Group();
  template.add(fbxModel);
  template.updateMatrixWorld(true);
  unityArrowTipLocal = getArrowTipPosition(template);
  unityArrowTemplate = template;
  if (currentStep()) renderCurrentArrows();
}).catch((error) => {
  showToast(`Could not load the Unity arrow model: ${error.message}`, true);
});

function createArrow() {
  if (!unityArrowTemplate || !unityArrowTipLocal) {
    throw new Error('The Unity arrow model is not ready yet.');
  }
  const arrow = new THREE.Group();
  arrow.scale.set(DEFAULT_ARROW_SCALE.x, DEFAULT_ARROW_SCALE.y, DEFAULT_ARROW_SCALE.z);
  arrow.userData.color = state.nextArrowColor;
  arrow.userData.tipOffset = unityArrowTipLocal.clone();
  const model = unityArrowTemplate.clone(true);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    child.material = new THREE.MeshStandardMaterial({
      color: state.nextArrowColor,
      emissive: new THREE.Color(state.nextArrowColor).multiplyScalar(0.28),
      emissiveIntensity: 0.8,
      metalness: 0.18,
      roughness: 0.28,
      depthTest: true,
    });
    child.renderOrder = 10;
    child.userData.isJarvisArrow = true;
  });
  arrow.add(model);
  return arrow;
}

function updateArrowAppearance(arrow, selected) {
  const color = selected ? SELECTED_ARROW_COLOR : arrow.userData.color || DEFAULT_ARROW_COLOR;
  const emissive = new THREE.Color(color).multiplyScalar(selected ? 0.45 : 0.28);
  arrow.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.color.set(color);
      material.emissive.copy(emissive);
      material.emissiveIntensity = selected ? 1 : 0.8;
    });
  });
}

function updateArrowAppearances() {
  state.arrowObjects.forEach((arrow, index) => {
    updateArrowAppearance(arrow, index === state.currentArrowIndex);
  });
}

function getArrowTipOffset(arrow) {
  return arrow.userData.tipOffset.clone().multiply(arrow.scale).applyQuaternion(arrow.quaternion);
}

// Unity imports right-handed FBX files (cm) into left-handed Unity space (m)
// by reflecting X and scaling by 0.01; CIP's model child sits at UNITY_MODEL_ROOT_OFFSET
// under the animation controller that parents spawned arrows.
function threeToUnityPosition(point) {
  return new THREE.Vector3(
    -point.x * UNITY_MODEL_UNIT_SCALE + UNITY_MODEL_ROOT_OFFSET.x,
    point.y * UNITY_MODEL_UNIT_SCALE + UNITY_MODEL_ROOT_OFFSET.y,
    point.z * UNITY_MODEL_UNIT_SCALE + UNITY_MODEL_ROOT_OFFSET.z,
  );
}

function unityToThreePosition(point) {
  return new THREE.Vector3(
    -(point.x - UNITY_MODEL_ROOT_OFFSET.x) / UNITY_MODEL_UNIT_SCALE,
    (point.y - UNITY_MODEL_ROOT_OFFSET.y) / UNITY_MODEL_UNIT_SCALE,
    (point.z - UNITY_MODEL_ROOT_OFFSET.z) / UNITY_MODEL_UNIT_SCALE,
  );
}

function flipHandednessQuaternion(quaternion) {
  return new THREE.Quaternion(quaternion.x, -quaternion.y, -quaternion.z, quaternion.w).normalize();
}

function unityDataFromThreeTransform(position, quaternion, scale) {
  const unityPosition = threeToUnityPosition(position);
  const unityQuaternion = flipHandednessQuaternion(quaternion);
  // Unity Transform.localEulerAngles applies Z, then X, then Y (Ry * Rx * Rz = Three.js 'YXZ').
  const euler = new THREE.Euler().setFromQuaternion(unityQuaternion, 'YXZ');
  return {
    position: {
      x: unityPosition.x,
      y: unityPosition.y,
      z: unityPosition.z,
    },
    rotation: {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    },
    scale: {
      x: scale.x,
      y: scale.y,
      z: scale.z,
    },
  };
}

function arrowTransformFromData(arrow, transform, unityCoordinates = false) {
  const position = transform?.position || {};
  const rotation = transform?.rotation || {};
  const scale = transform?.scale || DEFAULT_ARROW_SCALE;
  const scaleValue = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  arrow.scale.set(
    scaleValue(scale.x, DEFAULT_ARROW_SCALE.x),
    scaleValue(scale.y, DEFAULT_ARROW_SCALE.y),
    scaleValue(scale.z, DEFAULT_ARROW_SCALE.z),
  );
  const serializedPosition = new THREE.Vector3(
    Number(position.x) || 0,
    Number(position.y) || 0,
    Number(position.z) || 0,
  );
  arrow.rotation.order = 'XYZ';
  if (unityCoordinates) {
    const unityQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.x) || 0),
      THREE.MathUtils.degToRad(Number(rotation.y) || 0),
      THREE.MathUtils.degToRad(Number(rotation.z) || 0),
      'YXZ',
    ));
    arrow.quaternion.copy(flipHandednessQuaternion(unityQuaternion));
    arrow.position.copy(unityToThreePosition(serializedPosition));
  } else {
    arrow.rotation.set(
      THREE.MathUtils.degToRad(Number(rotation.x) || 0),
      THREE.MathUtils.degToRad(Number(rotation.y) || 0),
      THREE.MathUtils.degToRad(Number(rotation.z) || 0),
    );
    arrow.position.copy(serializedPosition);
  }
  arrow.userData.tipAnchor = arrow.position.clone().add(getArrowTipOffset(arrow));
}

function dataFromArrow(arrow) {
  const euler = new THREE.Euler().setFromQuaternion(arrow.quaternion, 'XYZ');
  return {
    position: { x: arrow.position.x, y: arrow.position.y, z: arrow.position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    },
    scale: {
      x: arrow.scale.x,
      y: arrow.scale.y,
      z: arrow.scale.z,
    },
  };
}

function unityDataFromArrow(arrow) {
  return unityDataFromThreeTransform(arrow.position, arrow.quaternion, {
    x: arrow.scale.x,
    y: arrow.scale.y,
    z: arrow.scale.z,
  });
}

function unityDataFromJarvisTransform(transform) {
  const position = transform?.position || {};
  const rotation = transform?.rotation || {};
  const scale = transform?.scale || DEFAULT_ARROW_SCALE;
  const scaleValue = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const threePosition = new THREE.Vector3(
    Number(position.x) || 0,
    Number(position.y) || 0,
    Number(position.z) || 0,
  );
  const threeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(Number(rotation.x) || 0),
    THREE.MathUtils.degToRad(Number(rotation.y) || 0),
    THREE.MathUtils.degToRad(Number(rotation.z) || 0),
    'XYZ',
  ));
  return unityDataFromThreeTransform(threePosition, threeQuaternion, {
    x: scaleValue(scale.x, DEFAULT_ARROW_SCALE.x),
    y: scaleValue(scale.y, DEFAULT_ARROW_SCALE.y),
    z: scaleValue(scale.z, DEFAULT_ARROW_SCALE.z),
  });
}

function removeArrowObjects() {
  for (const arrow of state.arrowObjects) {
    arrow.parent?.remove(arrow);
    arrow.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material.dispose();
      }
    });
  }
  state.arrowObjects = [];
  previewPositions.clear();
}

function renderCurrentArrows() {
  removeArrowObjects();
  const transforms = currentStep()?.animationIndicator;
  if (unityArrowTemplate && Array.isArray(transforms)) {
    const colors = colorsForStep();
    transforms.forEach((transform, index) => {
      const arrow = createArrow();
      arrowTransformFromData(arrow, transform, state.unityTransformSteps.has(currentStep()));
      arrow.userData.color = colors[index] || DEFAULT_ARROW_COLOR;
      (state.modelRoot || scene).add(arrow);
      state.arrowObjects.push(arrow);
    });
  }
  state.currentArrowIndex = state.arrowObjects.length
    ? state.currentArrowIndex >= 0 && state.currentArrowIndex < state.arrowObjects.length ? state.currentArrowIndex : 0
    : -1;
  updateArrowAppearances();
  renderInspector();
}

function renderWorkflow() {
  ui.workflowList.replaceChildren();
  if (!state.workflow?.sop?.length) {
    ui.workflowList.innerHTML = '<div class="empty-list">Open a workflow JSON or Excel scenario sheet to see its steps.</div>';
    $('#workflow-name').textContent = 'Open workflow JSON or Excel';
    $('#workflow-hint').textContent = 'JSON · XLSX scenario matrix';
    $('#step-count').textContent = '—';
    ui.exportButton.disabled = true;
    ui.previewButton.disabled = true;
    return;
  }
  $('#workflow-name').textContent = state.workflowFile;
  $('#workflow-hint').textContent = `${state.workflow.sop.length} scenes · workflow loaded`;
  const stepsTotal = state.workflow.sop.reduce((total, entry) => total + (entry.steps?.length || 0), 0);
  $('#step-count').textContent = `${stepsTotal} STEPS`;
  ui.exportButton.disabled = false;
  ui.previewButton.disabled = false;
  state.workflow.sop.forEach((entry, sceneIndex) => {
    const group = document.createElement('section');
    group.className = 'scene-group';
    const sceneButton = document.createElement('button');
    sceneButton.className = 'scene-title';
    sceneButton.innerHTML = `<span class="scene-chevron">⌄</span><span></span>`;
    sceneButton.querySelector('span:last-child').textContent = sceneTitle(entry);
    sceneButton.addEventListener('click', () => group.classList.toggle('collapsed'));
    const steps = document.createElement('div');
    steps.className = 'scene-steps';
    (entry.steps || []).forEach((step, stepIndex) => {
      const item = document.createElement('button');
      item.className = 'step-item';
      if (sceneIndex === state.currentSceneIndex && stepIndex === state.currentStepIndex) item.classList.add('active');
      const arrows = Array.isArray(step.animationIndicator) ? step.animationIndicator.length : 0;
      item.innerHTML = `<span class="step-number"></span><span class="step-label"></span><span class="step-arrow-count"></span>`;
      item.querySelector('.step-number').textContent = String(step.stepNo ?? stepIndex + 1).padStart(2, '0');
      item.querySelector('.step-label').textContent = stepLabel(step);
      item.querySelector('.step-arrow-count').textContent = arrows ? `↗ ${arrows}` : '';
      item.title = stepLabel(step);
      item.addEventListener('click', () => selectStep(sceneIndex, stepIndex));
      steps.appendChild(item);
    });
    group.append(sceneButton, steps);
    ui.workflowList.appendChild(group);
  });
}

function selectStep(sceneIndex, stepIndex) {
  stopPreview();
  state.currentSceneIndex = sceneIndex;
  state.currentStepIndex = stepIndex;
  state.currentArrowIndex = -1;
  state.placementMode = false;
  ui.placementButton.classList.remove('is-active');
  ui.placementButton.innerHTML = '<span class="crosshair-icon">⊕</span> Place arrow on model';
  renderWorkflow();
  renderCurrentArrows();
}

function renderInspector() {
  const sceneData = currentScene();
  const step = currentStep();
  const stepTotal = state.workflow?.sop?.reduce((total, entry) => total + (entry.steps?.length || 0), 0) || 0;
  const stepOrdinal = state.workflow?.sop?.slice(0, state.currentSceneIndex).reduce((total, entry) => total + (entry.steps?.length || 0), 0) + state.currentStepIndex + 1;
  $('#breadcrumb-scene').textContent = sceneData ? sceneTitle(sceneData) : 'No workflow loaded';
  $('#breadcrumb-step').textContent = step ? stepLabel(step) : 'Select a step';
  $('#inspector-title').textContent = step ? stepLabel(step) : 'No step selected';
  $('#step-tag').textContent = step ? `STEP ${step.stepNo ?? state.currentStepIndex + 1}` : '—';
  $('#step-instruction').textContent = step ? (step.instruction || step.title || 'No step instruction provided.') : 'Select a workflow step to view its content and place arrows.';
  const targets = step?.highlightTargets;
  const target = $('#highlight-target');
  target.hidden = !Array.isArray(targets) || !targets.length;
  target.textContent = targets?.length ? `TARGET · ${targets.join(', ')}` : '';
  const arrowCount = state.arrowObjects.length;
  $('#arrow-count').textContent = `${arrowCount} ${arrowCount === 1 ? 'placed' : 'placed'}`;
  $('#progress-value').textContent = step ? `${stepOrdinal} / ${stepTotal}` : '—';
  $('#progress-fill').style.width = stepTotal ? `${(stepOrdinal / stepTotal) * 100}%` : '0%';
  $('#stage-note').textContent = step
    ? (state.modelRoot ? (state.placementMode ? 'Click the model surface to place an arrow.' : 'Select an arrow to edit its transform, or place another.') : 'Load a model to place or preview arrows.')
    : 'Upload a model, then open a workflow to begin.';
  const canPlace = Boolean(step && state.modelRoot && !state.previewMode);
  ui.placementButton.disabled = !canPlace;
  $('#placement-help').textContent = !step
    ? 'Select a step and load a model to start placing arrows.'
    : !state.modelRoot
      ? 'Load a 3D model, then click to place an arrow.'
      : state.placementMode
        ? 'Click a point on the model. Click the button again to cancel.'
        : 'Each click places another arrow. Select any marker to edit.';
  const list = $('#arrow-list');
  list.replaceChildren();
  if (!arrowCount) {
    list.innerHTML = '<div class="arrow-empty">No arrows on this step.<br />Enable placement and click the model.</div>';
  } else {
    state.arrowObjects.forEach((arrow, index) => {
      const row = document.createElement('div');
      row.className = `arrow-row${state.currentArrowIndex === index ? ' selected' : ''}`;
      const pos = arrow.position;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'arrow-row-select';
      select.innerHTML = '<span class="arrow-row-icon">➤</span><span class="arrow-row-label"></span><span class="arrow-row-coord"></span>';
      select.querySelector('.arrow-row-icon').style.color = state.currentArrowIndex === index
        ? SELECTED_ARROW_COLOR
        : arrow.userData.color || DEFAULT_ARROW_COLOR;
      select.querySelector('.arrow-row-label').textContent = `Arrow ${String(index + 1).padStart(2, '0')}`;
      select.querySelector('.arrow-row-coord').textContent = `${formatNumber(pos.x)}, ${formatNumber(pos.y)}, ${formatNumber(pos.z)}`;
      select.setAttribute('aria-pressed', String(state.currentArrowIndex === index));
      select.addEventListener('click', () => selectArrow(index));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-arrow-row';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete arrow ${index + 1}`);
      remove.title = `Delete arrow ${index + 1}`;
      remove.addEventListener('click', () => removeArrow(index));
      row.append(select, remove);
      list.appendChild(row);
    });
  }
  renderTransformFields();
}

function selectArrow(index) {
  state.currentArrowIndex = index;
  updateArrowAppearances();
  setPlacementMode(false);
}

function renderTransformFields() {
  const container = $('#transform-fields');
  container.replaceChildren();
  const data = currentArrowData();
  const arrow = state.arrowObjects[state.currentArrowIndex];
  if (!data || !arrow) {
    container.innerHTML = '<div class="transform-empty">Select an arrow to edit its position, rotation, and scale.</div>';
    return;
  }
  const colorControl = document.createElement('label');
  colorControl.className = 'arrow-color-control';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'ARROW COLOR · JARVIS ONLY';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = arrow.userData.color || DEFAULT_ARROW_COLOR;
  colorInput.setAttribute('aria-label', 'Arrow color (JARVIS only; not included in exported JSON)');
  colorInput.addEventListener('input', () => {
    arrow.userData.color = colorInput.value;
    state.nextArrowColor = colorInput.value;
    $('#next-arrow-color').value = colorInput.value;
    colorsForStep()[state.currentArrowIndex] = colorInput.value;
    updateArrowAppearance(arrow, true);
    const icon = $('#arrow-list').children[state.currentArrowIndex]?.querySelector('.arrow-row-icon');
    if (icon) icon.style.color = SELECTED_ARROW_COLOR;
  });
  colorControl.append(colorLabel, colorInput);
  container.appendChild(colorControl);
  const groups = [
    { key: 'position', title: 'POSITION · MODEL UNITS', values: [arrow.position.x, arrow.position.y, arrow.position.z], css: 'pos' },
    { key: 'rotation', title: 'ROTATION · DEGREES', values: [arrow.rotation.x, arrow.rotation.y, arrow.rotation.z].map(THREE.MathUtils.radToDeg), css: 'rot' },
    { key: 'scale', title: 'SCALE · UNITY REFERENCE', values: [arrow.scale.x, arrow.scale.y, arrow.scale.z], css: 'scale' },
  ];
  groups.forEach((group) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'vector-group';
    const title = document.createElement('span');
    title.className = 'vector-title';
    title.textContent = group.title;
    const inputs = document.createElement('div');
    inputs.className = 'vector-inputs';
    ['x', 'y', 'z'].forEach((axis, axisIndex) => {
      const field = document.createElement('div');
      field.className = `vector-field ${group.css}`;
      const label = document.createElement('label');
      label.textContent = axis;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = group.key === 'rotation' ? '1' : group.key === 'scale' ? '0.00000001' : '0.01';
      input.value = group.key === 'scale'
        ? String(Number(group.values[axisIndex]))
        : Number(group.values[axisIndex]).toFixed(2);
      input.setAttribute('aria-label', `${group.key} ${axis}`);
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) {
          showToast('Enter a valid numeric transform value.', true);
          renderInspector();
          return;
        }
        const vec = group.key === 'position' ? arrow.position : group.key === 'rotation' ? arrow.rotation : arrow.scale;
        const converted = group.key === 'rotation' ? THREE.MathUtils.degToRad(value) : value;
        vec[axis] = converted;
        if (group.key === 'rotation') delete arrow.userData.previewDirection;
        if (arrow.userData.tipAnchor) {
          if (group.key === 'position') arrow.userData.tipAnchor.copy(arrow.position).add(getArrowTipOffset(arrow));
          else arrow.position.copy(arrow.userData.tipAnchor).sub(getArrowTipOffset(arrow));
        }
        syncCurrentStepData();
        renderInspector();
      });
      field.append(label, input);
      inputs.appendChild(field);
    });
    wrapper.append(title, inputs);
    container.appendChild(wrapper);
  });
  const remove = document.createElement('button');
  remove.className = 'delete-arrow';
  remove.textContent = 'Remove selected arrow ×';
  remove.addEventListener('click', removeSelectedArrow);
  container.appendChild(remove);
}

function syncCurrentStepData() {
  const step = currentStep();
  if (!step) return;
  state.unityTransformSteps.delete(step);
  step.arrowsApplicable = state.arrowObjects.length > 0;
  step.animationIndicator = state.arrowObjects.length ? state.arrowObjects.map(dataFromArrow) : null;
}

function workflowForUnityExport() {
  const workflow = JSON.parse(JSON.stringify(state.workflow));
  workflow.sop.forEach((sceneData, sceneIndex) => {
    sceneData.steps.forEach((step, stepIndex) => {
      if (!Array.isArray(step.animationIndicator) || state.unityTransformSteps.has(currentStepFor(sceneIndex, stepIndex))) return;
      const active = sceneIndex === state.currentSceneIndex && stepIndex === state.currentStepIndex;
      step.animationIndicator = active
        ? state.arrowObjects.map(unityDataFromArrow)
        : step.animationIndicator.map(unityDataFromJarvisTransform);
    });
  });
  return workflow;
}

function currentStepFor(sceneIndex, stepIndex) {
  return state.workflow?.sop?.[sceneIndex]?.steps?.[stepIndex];
}

function addArrowAt(hit) {
  const step = currentStep();
  if (!step || !state.modelRoot) return;
  if (!unityArrowTemplate) {
    showToast('The Unity arrow model is still loading. Try placing the arrow again shortly.', true);
    return;
  }
  const arrow = createArrow();
  const worldNormal = hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
  const modelNormalMatrix = new THREE.Matrix3().getNormalMatrix(state.modelRoot.matrixWorld).invert();
  const localNormal = worldNormal.clone().applyMatrix3(modelNormalMatrix).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), localNormal);
  arrow.userData.previewDirection = localNormal;
  const animationTravel = (UNITY_ARROW_ANIMATION_TRAVEL / UNITY_MODEL_UNIT_SCALE) * Math.abs(arrow.scale.x);
  const surfaceGap = Math.max(state.modelSize * ARROW_SURFACE_CLEARANCE_FACTOR, 0.002);
  const clearance = animationTravel + surfaceGap;
  arrow.userData.tipAnchor = state.modelRoot.worldToLocal(hit.point.clone().addScaledVector(worldNormal, clearance));
  arrow.position.copy(arrow.userData.tipAnchor).sub(getArrowTipOffset(arrow));
  state.modelRoot.add(arrow);
  state.arrowObjects.push(arrow);
  state.currentArrowIndex = state.arrowObjects.length - 1;
  colorsForStep()[state.currentArrowIndex] = arrow.userData.color;
  updateArrowAppearances();
  syncCurrentStepData();
  renderWorkflow();
  renderInspector();
  showToast(`Arrow ${String(state.arrowObjects.length).padStart(2, '0')} added to ${stepLabel(step)}.`);
}

function removeSelectedArrow() {
  removeArrow(state.currentArrowIndex);
}

function removeArrow(index) {
  if (index < 0 || index >= state.arrowObjects.length) return;
  const [arrow] = state.arrowObjects.splice(index, 1);
  colorsForStep().splice(index, 1);
  arrow.parent?.remove(arrow);
  arrow.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  });
  if (state.currentArrowIndex === index) {
    state.currentArrowIndex = state.arrowObjects.length ? Math.min(index, state.arrowObjects.length - 1) : -1;
  } else if (state.currentArrowIndex > index) {
    state.currentArrowIndex -= 1;
  }
  updateArrowAppearances();
  syncCurrentStepData();
  renderWorkflow();
  renderInspector();
}

function setPlacementMode(enabled) {
  state.placementMode = enabled;
  ui.placementButton.classList.toggle('is-active', enabled);
  ui.placementButton.innerHTML = enabled ? '<span class="crosshair-icon">⊙</span> Click model to place' : '<span class="crosshair-icon">⊕</span> Place arrow on model';
  ui.viewport.classList.toggle('placing', enabled);
  $('#placement-status').textContent = enabled ? 'CLICK MODEL TO PLACE' : 'RIGHT DRAG · ORBIT';
  renderInspector();
}

function eventPoint(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

let primaryPointerStart = null;
let suppressPrimaryClick = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button === 0) {
    primaryPointerStart = { x: event.clientX, y: event.clientY };
    suppressPrimaryClick = false;
  }
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button === 0) primaryPointerStart = null;
});

function modelIntersections() {
  if (!state.modelRoot) return [];
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(state.modelRoot, true).filter((hit) => !hit.object.userData.isJarvisArrow);
}

renderer.domElement.addEventListener('pointermove', (event) => {
  if (primaryPointerStart && Math.hypot(event.clientX - primaryPointerStart.x, event.clientY - primaryPointerStart.y) > 5) {
    suppressPrimaryClick = true;
  }
  eventPoint(event);
  const hit = modelIntersections()[0];
  state.hoveredPoint = hit?.point || null;
  hoverMarker.visible = Boolean(hit?.face);
  if (hit?.face) {
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    hoverMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    hoverMarker.position.copy(hit.point).addScaledVector(normal, Math.max(state.modelSize * 0.0005, 0.00001));
    hoverMarker.scale.setScalar(Math.max(state.modelSize * 0.008, 0.0005));
  }
  if (hit) {
    const point = state.modelRoot.worldToLocal(hit.point.clone());
    $('#coordinate-readout').innerHTML = `X ${formatNumber(point.x)} &nbsp; Y ${formatNumber(point.y)} &nbsp; Z ${formatNumber(point.z)}`;
  }
  renderer.domElement.style.cursor = state.placementMode && hit ? 'crosshair' : hit ? 'pointer' : 'default';
});
renderer.domElement.addEventListener('pointerleave', () => {
  state.hoveredPoint = null;
  hoverMarker.visible = false;
});
renderer.domElement.addEventListener('click', (event) => {
  if (event.button !== 0 || suppressPrimaryClick || !state.modelRoot || state.previewMode) {
    suppressPrimaryClick = false;
    return;
  }
  eventPoint(event);
  raycaster.setFromCamera(pointer, camera);
  const arrowHits = raycaster.intersectObjects(state.arrowObjects, true);
  const arrowHit = arrowHits.find((hit) => hit.object.userData.isJarvisArrow);
  if (arrowHit) {
    let node = arrowHit.object;
    while (node.parent && !state.arrowObjects.includes(node)) node = node.parent;
    const index = state.arrowObjects.indexOf(node);
    if (index >= 0) selectArrow(index);
    return;
  }
  if (!state.placementMode) return;
  const hit = modelIntersections()[0];
  if (hit?.face) addArrowAt(hit);
});

function parseWorkbookXml(bytes, path) {
  if (!bytes) throw new Error(`The workbook is missing ${path}.`);
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error(`Could not read workbook XML: ${path}.`);
  }
  return document;
}

function workbookRelationshipPath(target) {
  const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
  const parts = [];
  path.split('/').forEach((part) => {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  });
  return parts.join('/');
}

function columnIndexFromCellReference(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0];
  if (!letters) return -1;
  return letters.toUpperCase().split('').reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function readWorkbookSheetRows(archive, worksheetPath) {
  const worksheet = parseWorkbookXml(archive[worksheetPath], worksheetPath);
  const sharedStrings = archive['xl/sharedStrings.xml']
    ? Array.from(parseWorkbookXml(archive['xl/sharedStrings.xml'], 'xl/sharedStrings.xml').getElementsByTagNameNS('*', 'si'))
      .map((item) => item.textContent || '')
    : [];
  const sheetData = worksheet.getElementsByTagNameNS('*', 'sheetData')[0];
  if (!sheetData) throw new Error('The selected worksheet has no sheet data.');
  return Array.from(sheetData.getElementsByTagNameNS('*', 'row')).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagNameNS('*', 'c')).forEach((cell) => {
      const index = columnIndexFromCellReference(cell.getAttribute('r') || '');
      if (index < 0) return;
      const type = cell.getAttribute('t');
      const rawValue = type === 'inlineStr'
        ? cell.getElementsByTagNameNS('*', 'is')[0]?.textContent || ''
        : cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || '';
      values[index] = type === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
    });
    return values;
  });
}

async function readExcelScenarios(file) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const workbook = parseWorkbookXml(archive['xl/workbook.xml'], 'xl/workbook.xml');
  const relationships = parseWorkbookXml(archive['xl/_rels/workbook.xml.rels'], 'xl/_rels/workbook.xml.rels');
  const sheet = Array.from(workbook.getElementsByTagNameNS('*', 'sheet'))
    .find((item) => item.getAttribute('name')?.trim().toLowerCase() === 'sop comparison');
  if (!sheet) throw new Error('The workbook must contain a "SOP Comparison" worksheet.');
  const relationshipId = sheet.getAttribute('r:id')
    || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relationship = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))
    .find((item) => item.getAttribute('Id') === relationshipId);
  const worksheetPath = relationship && workbookRelationshipPath(relationship.getAttribute('Target') || '');
  if (!worksheetPath) throw new Error('Could not locate the "SOP Comparison" worksheet data.');
  const rows = readWorkbookSheetRows(archive, worksheetPath);
  const headerRowIndex = rows.findIndex((row) => String(row[0] ?? '').replace(/\u200B/g, '').trim().toLowerCase() === 'sequence name');
  if (headerRowIndex < 0) throw new Error('The "SOP Comparison" worksheet needs a "Sequence Name" column.');
  const scenarios = rows[headerRowIndex].slice(1).map((value, index) => ({
    name: String(value ?? '').trim(),
    columnIndex: index + 1,
  })).filter((scenario) => scenario.name);
  if (!scenarios.length) throw new Error('No scenario columns were found beside "Sequence Name".');
  return { rows, headerRowIndex, scenarios };
}

function chooseExcelScenario(scenarios) {
  if (scenarios.length === 1) return Promise.resolve(scenarios[0]);
  const dialog = $('#scenario-dialog');
  const select = $('#scenario-select');
  select.replaceChildren(...scenarios.map((scenario) => {
    const option = document.createElement('option');
    option.value = String(scenario.columnIndex);
    option.textContent = scenario.name;
    return option;
  }));
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      const selected = dialog.returnValue === 'load'
        ? scenarios.find((scenario) => String(scenario.columnIndex) === select.value) || null
        : null;
      resolve(selected);
    }, { once: true });
    dialog.showModal();
  });
}

function buildWorkflowFromScenario(rows, headerRowIndex, scenario) {
  const sequences = [];
  let currentSequence = null;
  rows.slice(headerRowIndex + 1).forEach((row) => {
    const sequenceTitle = String(row[0] ?? '').trim();
    if (sequenceTitle) {
      currentSequence = { title: sequenceTitle, steps: [] };
      sequences.push(currentSequence);
    }
    const instruction = String(row[scenario.columnIndex] ?? '').replace(/\r\n?/g, '\n').trim();
    if (!currentSequence || !instruction) return;
    const stepNo = currentSequence.steps.length + 1;
    const title = instruction.split('\n').map((line) => line.trim()).find(Boolean) || `Step ${stepNo}`;
    currentSequence.steps.push({ stepNo, title, instruction });
  });
  return {
    sop: sequences.filter((sequence) => sequence.steps.length).map((sequence, index) => ({
      sequenceId: index + 1,
      title: sequence.title,
      steps: sequence.steps,
    })),
  };
}

async function openWorkflow(file) {
  try {
    let parsed;
    let workflowFile = file.name;
    let workflowExportName = file.name.replace(/\.[^.]+$/, '');
    let selectedScenario = null;
    if (/\.xlsx$/i.test(file.name)) {
      const workbook = await readExcelScenarios(file);
      selectedScenario = await chooseExcelScenario(workbook.scenarios);
      if (!selectedScenario) return;
      parsed = buildWorkflowFromScenario(workbook.rows, workbook.headerRowIndex, selectedScenario);
      if (!parsed.sop.length) throw new Error(`No sequence steps were found in the "${selectedScenario.name}" column.`);
      workflowFile = `${selectedScenario.name} · ${file.name}`;
      workflowExportName = `workflow_${selectedScenario.name}`;
      if (isCipWorkflowName(workflowExportName)) workflowExportName = 'workflow_CIP';
    } else if (/\.xls$/i.test(file.name)) {
      throw new Error('Legacy .xls files are not supported. Save the workbook as .xlsx and retry.');
    } else {
      parsed = JSON.parse(await file.text());
    }
    if (!parsed || !Array.isArray(parsed.sop) || !parsed.sop.every((entry) => Array.isArray(entry.steps))) {
      throw new Error('This JSON does not contain the expected sop[].steps[] workflow structure.');
    }
    state.workflow = parsed;
    state.workflowFile = workflowFile;
    state.workflowExportName = workflowExportName;
    state.unityTransformSteps = new WeakSet();
    if (isCipWorkflowName(workflowExportName) && /\.json$/i.test(file.name)) {
      parsed.sop.forEach((sceneData) => sceneData.steps.forEach((step) => {
        if (Array.isArray(step.animationIndicator)) state.unityTransformSteps.add(step);
      }));
    }
    state.currentSceneIndex = -1;
    state.currentStepIndex = -1;
    const firstArrowStep = parsed.sop.findIndex((entry) => entry.steps.some((step) => step.arrowsApplicable || Array.isArray(step.animationIndicator)));
    if (firstArrowStep >= 0) {
      const firstStep = parsed.sop[firstArrowStep].steps.findIndex((step) => step.arrowsApplicable || Array.isArray(step.animationIndicator));
      selectStep(firstArrowStep, firstStep);
    } else if (parsed.sop.length && parsed.sop[0].steps.length) {
      selectStep(0, 0);
    } else {
      renderWorkflow();
      renderInspector();
    }
    $('#project-status').textContent = selectedScenario ? `${selectedScenario.name.toUpperCase()} LOADED` : 'WORKFLOW LOADED';
    showToast(selectedScenario ? `Loaded ${selectedScenario.name} from ${file.name}.` : `Loaded ${file.name}.`);
  } catch (error) {
    showToast(`Could not open workflow: ${error.message}`, true);
  }
}

function fileUrlMap(files) {
  const urls = new Map();
  for (const file of files) {
    urls.set(file.name.toLowerCase(), URL.createObjectURL(file));
  }
  return urls;
}

async function loadModel(files) {
  const chosen = Array.from(files || []);
  const modelFile = chosen.find((file) => /\.(fbx|glb|gltf|obj|stl)$/i.test(file.name));
  if (!modelFile) {
    showToast('Choose an FBX, GLB, GLTF, OBJ, or STL model file.', true);
    return;
  }
  try {
    showToast(`Loading ${modelFile.name}…`);
    const resources = fileUrlMap(chosen);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const decoded = decodeURIComponent(url);
      const filename = decoded.split(/[\\/]/).pop().split(/[?#]/)[0].toLowerCase();
      return resources.get(filename) || url;
    });
    const extension = modelFile.name.split('.').pop().toLowerCase();
    const mainUrl = resources.get(modelFile.name.toLowerCase());
    let root;
    if (extension === 'fbx') root = await new FBXLoader(manager).loadAsync(mainUrl);
    else if (extension === 'obj') {
      const mtlFile = chosen.find((file) => file.name.toLowerCase().endsWith('.mtl'));
      const loader = new OBJLoader(manager);
      if (mtlFile) {
        const materials = new MTLLoader(manager).parse(await mtlFile.text(), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      root = await loader.loadAsync(mainUrl);
    }
    else if (extension === 'stl') {
      const geometry = await new STLLoader(manager).loadAsync(mainUrl);
      geometry.computeVertexNormals();
      root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xa9aeb2, metalness: 0.55, roughness: 0.38 }));
    } else {
      const gltf = await new GLTFLoader(manager).loadAsync(mainUrl);
      root = gltf.scene;
    }
    if (state.modelRoot) {
      scene.remove(state.modelRoot);
      state.modelRoot.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.filter(Boolean).forEach((material) => material.dispose());
      });
    }
    removeArrowObjects();
    state.modelRoot = root;
    scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) throw new Error('The model contains no visible geometry.');
    const size = bounds.getSize(new THREE.Vector3());
    state.modelDimensions.copy(size);
    state.modelSize = Math.max(size.x, size.y, size.z, 0.001);
    state.modelCenter.copy(bounds.getCenter(new THREE.Vector3()));
    fitCamera();
    state.modelFile = modelFile.name;
    $('#model-name').textContent = modelFile.name;
    $('#model-hint').textContent = `${extension.toUpperCase()} · model loaded`;
    $('#model-badge').classList.add('loaded');
    $('#model-badge').innerHTML = '<span></span> MODEL READY';
    $('#viewport-model-label').textContent = modelFile.name.toUpperCase();
    ui.emptyState.classList.add('hidden');
    $('#project-status').textContent = 'MODEL READY';
    if (currentStep()) renderCurrentArrows();
    showToast(`Loaded ${modelFile.name}.`);
    window.setTimeout(() => resources.forEach((resourceUrl) => URL.revokeObjectURL(resourceUrl)), 5000);
  } catch (error) {
    showToast(`Could not load model: ${error.message}`, true);
  }
}

function exportWorkflow() {
  if (!state.workflow) return;
  const isCipWorkflow = isCipWorkflowName(state.workflowExportName);
  if (isCipWorkflow && !unityArrowTemplate) {
    showToast('The Unity arrow model is still loading. Try exporting again shortly.', true);
    return;
  }
  const hasLocalArrows = state.workflow.sop.some((sceneData) => sceneData.steps.some((step) =>
    Array.isArray(step.animationIndicator) && !state.unityTransformSteps.has(step),
  ));
  if (isCipWorkflow && hasLocalArrows && !state.modelRoot) {
    showToast('Load the CIP model before exporting arrow positions.', true);
    return;
  }
  const workflow = isCipWorkflow ? workflowForUnityExport() : state.workflow;
  const payload = JSON.stringify(workflow, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const fileName = `${(state.workflowExportName || 'workflow')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').replace(/[. ]+$/g, '')}.json`;
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${fileName}`);
}

function stopPreview() {
  if (!state.previewMode) return;
  state.previewMode = false;
  ui.viewport.classList.remove('previewing');
  ui.previewButton.innerHTML = '▷ <span>Preview</span>';
  $('#placement-status').textContent = 'RIGHT DRAG · ORBIT';
  controls.enabled = true;
  $('#front-axis').disabled = false;
  previewPositions.clear();
  state.arrowObjects.forEach((arrow) => arrow.position.copy(arrow.userData.basePosition || arrow.position));
  renderInspector();
}

function startPreview() {
  if (!state.modelRoot || !currentStep() || !state.arrowObjects.length) {
    showToast('Load a model, select a step, and place at least one arrow to preview.', true);
    return;
  }
  state.previewMode = true;
  setPlacementMode(false);
  state.arrowObjects.forEach((arrow) => {
    arrow.userData.basePosition = arrow.position.clone();
    previewPositions.set(arrow, arrow.position.clone());
  });
  controls.enabled = true;
  $('#front-axis').disabled = false;
  ui.viewport.classList.add('previewing');
  ui.previewButton.innerHTML = '■ <span>Exit preview</span>';
  $('#placement-status').textContent = `${viewDirections[state.frontViewKey].label} VIEW · PREVIEW`;
  setCameraView(state.frontViewKey);
  previewStarted = performance.now();
  renderInspector();
}

function animate(now = 0) {
  requestAnimationFrame(animate);
  controls.update();
  if (state.previewMode) {
    const elapsed = (now - previewStarted) / 1000;
    const phase = (1 - Math.cos((elapsed / UNITY_ARROW_ANIMATION_PERIOD) * Math.PI * 2)) * 0.5;
    for (const arrow of state.arrowObjects) {
      const base = previewPositions.get(arrow);
      if (!base) continue;
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(arrow.quaternion);
      const travel = (UNITY_ARROW_ANIMATION_TRAVEL / UNITY_MODEL_UNIT_SCALE) * arrow.scale.x * phase;
      arrow.position.copy(base).addScaledVector(localX, travel);
    }
  }
  renderer.render(scene, camera);
}
animate();

ui.workflowUpload.addEventListener('click', () => ui.workflowInput.click());
ui.modelUpload.addEventListener('click', () => ui.modelInput.click());
$('#empty-model-upload').addEventListener('click', () => ui.modelInput.click());
ui.workflowInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) openWorkflow(file);
  event.target.value = '';
});
ui.modelInput.addEventListener('change', (event) => {
  if (event.target.files?.length) loadModel(event.target.files);
  event.target.value = '';
});
ui.exportButton.addEventListener('click', exportWorkflow);
ui.placementButton.addEventListener('click', () => setPlacementMode(!state.placementMode));
ui.previewButton.addEventListener('click', () => state.previewMode ? stopPreview() : startPreview());
$('#next-arrow-color').addEventListener('input', (event) => {
  state.nextArrowColor = event.target.value;
});
$('#pointer-color').addEventListener('input', (event) => {
  state.pointerColor = event.target.value;
  hoverMaterial.color.set(state.pointerColor);
});
$('#reset-camera').addEventListener('click', fitCamera);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.placementMode) setPlacementMode(false);
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.currentArrowIndex >= 0 && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) removeSelectedArrow();
});
renderWorkflow();
renderInspector();
