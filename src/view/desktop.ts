import * as THREE from "three";
import * as RAPIER from "@dimforge/rapier3d-compat";
import {SynthAudio} from "../audio/synth.js";
import {
  CHALLENGES,
  StackSession,
  TABLE_WIDTH,
  decodeSave,
  encodeSave,
  sessionFromSave,
  type BlockSpec,
  type StackSnapshot,
} from "../model/stack.js";

interface FileContext {
  owner: string;
  valid(): boolean;
  path(value: string): string;
  name(value: string): string;
  files: {
    read(path: string): Promise<{data: Uint8Array; version: string; status?: string}>;
    write(path: string, data: Uint8Array, expected: string | null): Promise<{version: string; status?: string}>;
    stat?(path: string): Promise<{version: string; status?: string}>;
    subscribe?(callback: () => void): () => void;
    sync(): Promise<unknown>;
  };
}

export interface Host {
  signal: AbortSignal;
  w?: {
    title?: string;
    ownerSub?: string;
    launchContext?: {version: 1; storage: "mirror"; path: string; owner: string};
    stackBalance?: {dirty: boolean};
  };
  ui: {
    make(tag: string, className?: string, text?: string): HTMLElement;
    textButton(label: string, action: () => void): HTMLButtonElement;
    appInput(label: string, value?: string): HTMLInputElement;
    confirm?(message: string, options?: {
      title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; signal?: AbortSignal;
    }): Promise<boolean>;
  };
  storage: {
    signedInSubject(): string;
    mirrorFileContext(): Promise<FileContext>;
    pickFile(options: {extensions: string[]; signal?: AbortSignal}): Promise<string | null>;
    pickFolder(options: {signal?: AbortSignal}): Promise<string | null>;
  };
}

export interface ViewHandle {
  element: HTMLElement;
  dispose(): void;
}

let rapierReady: Promise<void> | null = null;
const ensureRapier = () => rapierReady ??= RAPIER.init();

const BLOCK_COLORS: Record<BlockSpec["shape"], number> = {
  square: 0x76b7e8,
  wide: 0xe0a95d,
  tall: 0xa78ad9,
  beam: 0x75c58b,
};

export async function startView(host: Host, signal: AbortSignal): Promise<ViewHandle> {
  await ensureRapier();
  const doc = document;
  const {make, textButton, appInput} = host.ui;
  const owner = host.w?.launchContext?.owner || host.storage.signedInSubject();
  const windowState = host.w?.stackBalance ?? {dirty: false};
  if (host.w) {
    host.w.stackBalance = windowState;
    host.w.ownerSub = owner;
  }

  let session = new StackSession(`stack-${crypto.randomUUID()}`, 0);
  let paused = true;
  let disposed = false;
  let busy = false;
  let dirty = false;
  let revision = 0;
  let selectedChallenge = 0;
  let practice = false;
  let savedPath: string | null = null;
  let savedVersion: string | null = null;
  let unwatch = () => {};
  let watchSerial = 0;
  let watchCheck = 0;
  let frame = 0;
  let last = performance.now();
  let phaseBefore = session.phase;
  let dragPointer: number | null = null;
  let lastLayout = "";
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let centerGuide: THREE.Line | null = null;
  let world: RAPIER.World | null = null;
  const meshes: THREE.Mesh[] = [];
  const proceduralMaterials: Array<THREE.Material | THREE.BufferGeometry> = [];
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const audio = new SynthAudio();

  const element = make("section", "stack-view");
  const header = make("header", "stack-header");
  header.append(
    make("div", "stack-heading", "Stack & Balance"),
    make("p", "stack-subtitle", "Place each piece, steady the tower, then survive one measured nudge."),
  );
  const toolbar = make("div", "stack-toolbar");
  const canvasHost = make("div", "stack-stage");
  const side = make("aside", "stack-side");
  const notice = make("div", "stack-notice");
  notice.hidden = true;
  notice.setAttribute("role", "status");
  const status = make("div", "app-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const runButton = textButton("Run", () => toggleRun());
  const restartButton = textButton("Restart", () => void restart());
  const moveLeft = textButton("◀ Move left", () => move(-0.5));
  const moveRight = textButton("Move right ▶", () => move(0.5));
  const rotate = textButton("Rotate block", () => rotateBlock());
  const release = textButton("Release block", () => releaseBlock());
  const openButton = textButton("Open from My files", () => void open());
  const saveButton = textButton("Save to My files", () => void save());
  toolbar.append(runButton, restartButton, openButton, saveButton);

  const challenge = doc.createElement("select");
  challenge.setAttribute("aria-label", "Challenge");
  CHALLENGES.forEach((item, index) => challenge.append(new Option(`Challenge ${index + 1} · height ${item.heightTarget}`, String(index))));
  const practiceToggle = doc.createElement("input");
  practiceToggle.type = "checkbox";
  practiceToggle.setAttribute("aria-label", "Half-speed practice");
  const sound = doc.createElement("input");
  sound.type = "checkbox";
  sound.setAttribute("aria-label", "Sound effects");
  const volume = doc.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "30";
  volume.disabled = true;
  volume.setAttribute("aria-label", "Sound volume");
  const reduced = doc.createElement("input");
  reduced.type = "checkbox";
  reduced.setAttribute("aria-label", "Reduce motion");
  const contrast = doc.createElement("input");
  contrast.type = "checkbox";
  contrast.setAttribute("aria-label", "High contrast");
  const centerMarker = doc.createElement("input");
  centerMarker.type = "checkbox";
  centerMarker.setAttribute("aria-label", "Center-of-mass guide");
  const challengeLabel = make("label", "stack-control", "Challenge ");
  challengeLabel.append(challenge);
  const practiceLabel = make("label", "stack-control", "Practice ");
  practiceLabel.append(practiceToggle);
  const info = make("div", "stack-info");
  const coach = make("div", "stack-rive-pending", "Stability instrument · procedural placeholder until balance-meter.riv is authored");
  const settings = doc.createElement("details");
  settings.append(make("summary", "", "Settings"));
  for (const [label, input] of [
    ["Sound effects", sound],
    ["Sound volume", volume],
    ["Reduce motion", reduced],
    ["High contrast", contrast],
    ["Center-of-mass guide", centerMarker],
  ] as Array<[string, HTMLInputElement]>) {
    const field = make("label", "stack-control", label + " ");
    field.append(input);
    settings.append(field);
  }
  const help = doc.createElement("details");
  help.append(
    make("summary", "", "How to play"),
    make("p", "", "Drag the placement marker or use the move buttons. Rotate awkward blocks before release. When the sequence is complete, keep every piece supported above the line through the dwell period and one announced nudge. Practice halves model time without changing geometry or support rules."),
  );
  const saveDetails = doc.createElement("details");
  saveDetails.className = "stack-save";
  const path = appInput("Stack save path", host.w?.launchContext?.path || "/Stack Balance.game.json");
  const folder = textButton("Choose folder", () => void chooseFolder());
  const saveFields = make("div", "stack-save-fields");
  saveFields.append(path, folder);
  saveDetails.append(make("summary", "", "Save location"), saveFields);
  const primaryControls = make("div", "stack-controls");
  primaryControls.append(moveLeft, rotate, moveRight, release);
  side.append(coach, info, challengeLabel, practiceLabel, settings, help, saveDetails);
  element.append(header, toolbar, canvasHost, primaryControls, side, notice, status);

  const valid = () => !disposed && !signal.aborted && element.isConnected && owner === host.storage.signedInSubject();
  const announce = (message: string) => {
    if (valid()) status.textContent = message;
  };
  const mark = () => {
    dirty = true;
    windowState.dirty = true;
    revision += 1;
  };
  const clearDirty = () => {
    dirty = false;
    windowState.dirty = false;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    if (value) cancelDrag();
    refresh();
  };

  function toggleRun(): void {
    if (busy || session.phase === "won" || session.phase === "collapsed") return;
    paused = !paused;
    if (paused) cancelDrag();
    last = performance.now();
    audio.setMuted(!sound.checked);
    if (!paused && sound.checked) audio.unlock();
    if (paused) audio.suspend();
    mark();
    announce(paused ? "Bench paused." : "Bench running. Place the next block or steady the tower.");
    refresh();
  }

  function move(delta: number): void {
    if (busy || paused || session.phase !== "build" || session.active === null) return;
    session.positionBlock(session.active.x + delta);
    mark();
    refresh();
  }

  function rotateBlock(): void {
    if (busy || paused || session.phase !== "build") return;
    session.rotateBlock();
    audio.tone(240, 45, "triangle");
    mark();
    refresh();
  }

  function releaseBlock(): void {
    if (busy || paused || session.phase !== "build") return;
    session.releaseBlock();
    audio.tone((session.phase as string) === "collapsed" ? 90 : 150, 80, "square");
    mark();
    refresh();
  }

  async function restart(): Promise<void> {
    if (busy || !valid()) return;
    setBusy(true);
    const before = encodeSave(session);
    const atRevision = revision;
    const challengeId = selectedChallenge;
    paused = true;
    refresh();
    try {
      if (dirty && !await host.ui.confirm?.("Start this challenge again and discard unsaved progress?", {
        title: "Restart Stack & Balance", confirmLabel: "Restart", cancelLabel: "Keep tower", danger: true, signal,
      })) {
        selectedChallenge = session.challengeId;
        announce("Current tower kept.");
        return;
      }
      if (!valid()) return;
      if (revision !== atRevision || encodeSave(session) !== before || selectedChallenge !== challengeId) {
        selectedChallenge = session.challengeId;
        throw new Error("The tower changed while confirming. Try again.");
      }
      clearWatch();
      session = new StackSession(`stack-${crypto.randomUUID()}`, selectedChallenge);
      session.practice = practice;
      paused = true;
      savedPath = null;
      savedVersion = null;
      if (host.w) delete host.w.launchContext;
      clearDirty();
      revision += 1;
      phaseBefore = session.phase;
      path.value = "/Stack Balance.game.json";
      lastLayout = "";
      announce("Challenge ready. Press Run, then place the first block.");
    } catch (error) {
      announce("Could not restart challenge: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  }

  function refresh(): void {
    challenge.value = String(session.challengeId);
    practiceToggle.checked = session.practice;
    runButton.textContent = paused ? "Run" : "Pause";
    runButton.setAttribute("aria-label", runButton.textContent);
    runButton.disabled = busy || session.phase === "won" || session.phase === "collapsed";
    restartButton.disabled = busy;
    openButton.disabled = busy;
    saveButton.disabled = busy;
    challenge.disabled = busy;
    practiceToggle.disabled = busy;
    moveLeft.disabled = busy || paused || session.phase !== "build";
    moveRight.disabled = busy || paused || session.phase !== "build";
    rotate.disabled = busy || paused || session.phase !== "build";
    release.disabled = busy || paused || session.phase !== "build";
    path.disabled = busy;
    folder.disabled = busy;
    const nudge = session.phase === "nudge" ? ` · nudge ${Math.min(300, Math.round(session.nudgeMs))}/300 ms` : "";
    info.textContent = `${session.phase} · height ${session.topHeight().toFixed(1)}/${session.challenge.heightTarget} · dwell ${Math.round(session.dwellMs)} ms${nudge}`;
    if (valid()) drawScene();
  }

  async function chooseFolder(): Promise<void> {
    try {
      const selected = await host.storage.pickFolder({signal});
      if (selected === null || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      if (!valid() || !context.valid()) return;
      path.value = context.path(
        (selected === "/" ? "" : selected) + "/" + context.name(path.value.split("/").pop() || "Stack Balance.game.json"),
      );
    } catch (error) {
      announce("Could not choose folder: " + (error instanceof Error ? error.message : "unknown error"));
    }
  }

  function clearWatch(): void {
    watchSerial += 1;
    watchCheck += 1;
    unwatch();
    unwatch = () => {};
    notice.hidden = true;
  }

  function watch(context: FileContext, filePath: string, version: string): void {
    clearWatch();
    const serial = watchSerial;
    const check = async () => {
      const checkId = ++watchCheck;
      if (!valid() || !context.valid() || savedPath !== filePath || savedVersion !== version) return;
      let message = "";
      try {
        const current = context.files.stat ? await context.files.stat(filePath) : await context.files.read(filePath);
        if (current.status === "conflict") message = "This tower save has conflicting copies. Resolve them in Files.";
        else if (current.version !== version) message = "The saved tower changed. Your live tower is unchanged; save a copy or reopen it.";
      } catch {
        message = "The saved tower is unavailable. Your live tower is unchanged.";
      }
      if (valid() && context.valid() && serial === watchSerial && checkId === watchCheck) {
        notice.textContent = message;
        notice.hidden = !message;
      }
    };
    unwatch = context.files.subscribe?.(check) || (() => {});
    queueMicrotask(check);
  }

  async function save(): Promise<void> {
    if (busy || !valid()) return;
    const wasDirty = dirty;
    const atRevision = revision;
    const requested = path.value;
    const captured = encodeSave(session);
    paused = true;
    audio.suspend();
    dirty = true;
    windowState.dirty = true;
    setBusy(true);
    let committed = false;
    try {
      const context = await host.storage.mirrorFileContext();
      const target = context.path(requested);
      if (!target.toLowerCase().endsWith(".game.json")) throw new Error("Use a .game.json file name.");
      let expected: string | null = null;
      try {
        const existing = context.files.stat ? await context.files.stat(target) : await context.files.read(target);
        if (existing.status === "conflict") throw new Error("Resolve the conflict in Files first.");
        if (target === savedPath && savedVersion) {
          if (existing.version !== savedVersion) throw new Error("The saved tower changed. Save a copy or reopen it.");
        } else if (!await host.ui.confirm?.("Replace " + target + "?", {
          title: "Replace saved tower", confirmLabel: "Replace", cancelLabel: "Cancel", danger: true, signal,
        })) {
          announce("Save cancelled. Tower remains paused.");
          return;
        }
        expected = existing.version;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "File not found.") throw error;
        if (target === savedPath && savedVersion) throw new Error("The saved tower was removed. Save a copy or reopen it.");
      }
      if (!valid() || !context.valid()) return;
      const result = await context.files.write(target, new TextEncoder().encode(captured), expected);
      if (!valid() || !context.valid()) return;
      savedPath = target;
      savedVersion = result.version;
      if (path.value === requested) path.value = target;
      if (host.w) {
        host.w.title = target.split("/").pop() + " — Stack & Balance";
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
      }
      const newer = revision !== atRevision || encodeSave(session) !== captured;
      dirty = newer;
      windowState.dirty = newer;
      committed = true;
      watch(context, target, result.version);
      announce(result.status === "conflict"
        ? "Saved on this device with conflicting copies. Resolve them in Files."
        : newer
          ? "Saved an earlier tower; newer changes remain unsaved."
          : "Tower saved to My files; syncing with the server.");
    } catch (error) {
      announce("Could not save: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      if (!committed && valid() && revision === atRevision) {
        dirty = wasDirty;
        windowState.dirty = wasDirty;
      }
      setBusy(false);
    }
  }

  async function open(selected?: string): Promise<void> {
    if (busy || !valid()) return;
    const live = session;
    const before = encodeSave(live);
    const atRevision = revision;
    setBusy(true);
    paused = true;
    refresh();
    try {
      if (dirty && !await host.ui.confirm?.("Open a saved tower and discard current progress?", {
        title: "Unsaved tower", confirmLabel: "Discard progress", cancelLabel: "Keep tower", danger: true, signal,
      })) {
        announce("Tower paused. Press Run when ready.");
        return;
      }
      if (!valid()) return;
      if (session !== live || revision !== atRevision || encodeSave(session) !== before) {
        throw new Error("The tower changed while confirming. Try again.");
      }
      announce("Opening saved tower…");
      const choice = selected || await host.storage.pickFile({extensions: [".game.json"], signal});
      if (!choice || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      const target = context.path(choice);
      const file = await context.files.read(target);
      announce("Validating saved tower…");
      if (file.status === "conflict") throw new Error("Resolve the conflict in Files first.");
      if (file.data.byteLength > 8 * 1024 * 1024) throw new Error("Tower save is too large.");
      const payload = decodeSave(new TextDecoder("utf-8", {fatal: true}).decode(file.data)).payload;
      const replacement = sessionFromSave({payload});
      if (!valid() || !context.valid()) return;
      if (session !== live || revision !== atRevision || encodeSave(session) !== before) {
        throw new Error("The tower changed while opening. Try again.");
      }
      session = replacement;
      paused = true;
      selectedChallenge = session.challengeId;
      practice = session.practice;
      savedPath = target;
      savedVersion = file.version;
      path.value = target;
      challenge.value = String(session.challengeId);
      practiceToggle.checked = session.practice;
      clearDirty();
      lastLayout = "";
      phaseBefore = session.phase;
      if (host.w) {
        host.w.title = target.split("/").pop() + " — Stack & Balance";
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
      }
      watch(context, target, file.version);
      refresh();
      announce("Tower loaded and paused. Press Run when ready.");
    } catch (error) {
      announce("Could not open tower: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  }

  function resetWorld(): void {
    world?.free();
    world = new RAPIER.World({x: 0, y: -9.81, z: 0});
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(TABLE_WIDTH / 2, 0.3, 2.1).setFriction(0.9), floor);
  }

  function discardBlockMesh(mesh: THREE.Mesh): void {
    scene?.remove(mesh);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.geometry.dispose();
    for (const material of materials) material.dispose();
    for (const resource of [mesh.geometry, ...materials]) {
      const index = proceduralMaterials.indexOf(resource);
      if (index >= 0) proceduralMaterials.splice(index, 1);
    }
  }

  function createScene(): void {
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    canvasHost.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(contrast.checked ? 0x05070b : 0x172033);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(10, 8.5, 14);
    camera.lookAt(0, 3.5, 0);
    const hemi = new THREE.HemisphereLight(0xe9e2d3, 0x273040, 1.25);
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(5, 12, 7);
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE_WIDTH, 0.35, 4.2),
      new THREE.MeshStandardMaterial({color: contrast.checked ? 0x171b22 : 0x624a34, roughness: 0.82}),
    );
    table.position.set(0, -0.18, 0);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-TABLE_WIDTH / 2, 4, 1.8),
        new THREE.Vector3(TABLE_WIDTH / 2, 4, 1.8),
      ]),
      new THREE.LineDashedMaterial({color: 0xe8d36f, dashSize: 0.3, gapSize: 0.18}),
    );
    line.computeLineDistances();
    centerGuide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 1.9), new THREE.Vector3(0, 1, 1.9)]),
      new THREE.LineDashedMaterial({color: 0x7bdff2, dashSize: 0.22, gapSize: 0.16}),
    );
    centerGuide.computeLineDistances();
    scene.add(hemi, sun, table, line, centerGuide);
    proceduralMaterials.push(
      table.geometry,
      table.material as THREE.Material,
      line.geometry,
      line.material as THREE.Material,
      centerGuide.geometry,
      centerGuide.material as THREE.Material,
    );
    resetWorld();
    const resize = () => {
      if (!renderer || !camera || !canvasHost.isConnected) return;
      const width = Math.max(1, canvasHost.clientWidth);
      const height = Math.max(1, canvasHost.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvasHost);
    listeners.push([canvasHost, "stack-resize", resize]);
    (canvasHost as HTMLElement & {stackObserver?: ResizeObserver}).stackObserver = observer;
    resize();
  }

  function addBlockMesh(spec: BlockSpec, x: number, y: number, active = false, rested = true): void {
    if (!scene || !world) return;
    const color = active ? 0xe8d54c : BLOCK_COLORS[spec.shape];
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      transparent: active,
      opacity: active ? 0.55 : 1,
      emissive: active ? 0x5d4e12 : 0x000000,
    });
    const geometry = new THREE.BoxGeometry(spec.width, spec.height, 1.8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x - TABLE_WIDTH / 2, y + spec.height / 2, 0);
    if (!rested) mesh.rotation.z = 0.24;
    scene.add(mesh);
    meshes.push(mesh);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(mesh.position.x, mesh.position.y, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, 0.9), body);
    proceduralMaterials.push(geometry, material);
  }

  function drawScene(): void {
    if (!scene || !renderer || !camera || !world) return;
    const key = JSON.stringify(session.snapshot());
    if (key !== lastLayout) {
      for (const mesh of meshes) discardBlockMesh(mesh);
      meshes.length = 0;
      resetWorld();
      for (const block of session.blocks) addBlockMesh(block, block.x, block.y, false, block.rested);
      const activeSpec = session.activeSpec();
      if (activeSpec && session.active) {
        addBlockMesh(activeSpec, session.active.x, session.topHeight(), true, true);
      }
      world.step();
      lastLayout = key;
    }
    if (centerGuide) {
      centerGuide.visible = centerMarker.checked && session.active !== null;
      if (session.active) centerGuide.position.x = session.active.x - TABLE_WIDTH / 2;
      centerGuide.scale.y = session.challenge.heightTarget + 1;
    }
    renderer.render(scene, camera);
  }

  const animate = (now: number) => {
    if (disposed) return;
    watchWindow();
    const delta = Math.min(100, Math.max(0, now - last));
    last = now;
    if (!paused) session.advance(delta);
    if (session.phase !== phaseBefore) {
      if (session.phase === "nudge") {
        audio.tone(520, 100, "triangle");
        announce("Nudge in 300 ms. Hold steady.");
      } else if (session.phase === "won") {
        audio.tone(660, 160, "triangle");
        mark();
        announce("Tower stable. Challenge complete.");
      } else if (session.phase === "collapsed") {
        audio.tone(110, 220, "sawtooth");
        mark();
        announce("The tower moved. Restart or choose a gentler position.");
      }
      phaseBefore = session.phase;
      refresh();
    } else if (!paused) {
      refresh();
    }
    drawScene();
    frame = requestAnimationFrame(animate);
  };

  challenge.addEventListener("change", () => {
    if (busy) {
      challenge.value = String(session.challengeId);
      return;
    }
    selectedChallenge = Number(challenge.value);
    void restart();
  });
  practiceToggle.addEventListener("change", () => {
    practice = practiceToggle.checked;
    session.practice = practice;
    mark();
    refresh();
  });
  sound.addEventListener("change", () => {
    volume.disabled = !sound.checked;
    audio.setMuted(!sound.checked);
    if (sound.checked) audio.unlock();
  });
  volume.addEventListener("input", () => audio.setVolume(Number(volume.value) / 100));
  contrast.addEventListener("change", () => {
    if (scene) scene.background = new THREE.Color(contrast.checked ? 0x05070b : 0x172033);
    lastLayout = "";
    refresh();
  });
  const pointerPosition = (event: PointerEvent): number => {
    const rect = renderer!.domElement.getBoundingClientRect();
    return (event.clientX - rect.left) / Math.max(1, rect.width) * TABLE_WIDTH;
  };
  const cancelDrag = () => {
    const pointer = dragPointer;
    dragPointer = null;
    if (pointer !== null && renderer?.domElement.hasPointerCapture(pointer)) renderer.domElement.releasePointerCapture(pointer);
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || dragPointer !== null || busy || paused || session.phase !== "build" || !renderer) return;
    dragPointer = event.pointerId;
    renderer.domElement.setPointerCapture(event.pointerId);
    session.positionBlock(pointerPosition(event));
    mark();
    refresh();
  };
  const pointerMove = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId || busy || paused) return;
    session.positionBlock(pointerPosition(event));
    mark();
    refresh();
  };
  const pointerUp = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) return;
    cancelDrag();
    releaseBlock();
  };
  const pointerCancel = (event: PointerEvent) => {
    if (dragPointer === event.pointerId) cancelDrag();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const action: Record<string, () => void> = {
      ArrowLeft: () => move(-0.5),
      ArrowRight: () => move(0.5),
      q: rotateBlock,
      Q: rotateBlock,
      e: rotateBlock,
      E: rotateBlock,
      " ": releaseBlock,
      Escape: () => {
        if (!paused) toggleRun();
      },
    };
    const handler = action[event.key];
    if (!handler) return;
    event.preventDefault();
    if (event.repeat && !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    handler();
  };
  const suspend = () => {
    cancelDrag();
    if (!paused) {
      paused = true;
      audio.suspend();
      refresh();
      announce("Tower paused when its window lost attention. Press Run when ready.");
    }
  };
  const visibility = () => {
    if (doc.hidden) suspend();
  };
  let observedWindow: HTMLElement | null = null;
  const windowObserver = new MutationObserver(() => {
    const target = observedWindow;
    if (target && (target.hidden || target.classList.contains("rolled") || !target.classList.contains("focused"))) suspend();
  });
  const watchWindow = () => {
    const target = element.closest<HTMLElement>(".window");
    if (target !== observedWindow) {
      windowObserver.disconnect();
      observedWindow = target;
      if (target) windowObserver.observe(target, {attributes: true, attributeFilter: ["class", "hidden"]});
    }
    if (target && (target.hidden || target.classList.contains("rolled") || !target.classList.contains("focused"))) suspend();
  };

  createScene();
  const canvas = renderer!.domElement;
  listeners.push(
    [canvas, "pointerdown", pointerDown as EventListener],
    [canvas, "pointermove", pointerMove as EventListener],
    [canvas, "pointerup", pointerUp as EventListener],
    [canvas, "pointercancel", pointerCancel as EventListener],
    [canvas, "lostpointercapture", pointerCancel as EventListener],
    [element, "keydown", keyboard as EventListener],
    [window, "blur", suspend],
    [doc, "visibilitychange", visibility],
  );
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  element.tabIndex = 0;
  refresh();
  frame = requestAnimationFrame(animate);

  if (host.w?.launchContext?.storage === "mirror" && host.w.launchContext.owner === owner) {
    const initialPath = host.w.launchContext.path;
    path.value = initialPath;
    const openWhenConnected = (attempt = 0): void => {
      if (disposed || signal.aborted) return;
      if (!element.isConnected && attempt < 60) setTimeout(() => openWhenConnected(attempt + 1), 16);
      else if (valid()) void open(initialPath);
    };
    queueMicrotask(() => openWhenConnected());
  } else {
    announce("Press Run, place each block, then survive the nudge.");
  }

  return {
    element,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelDrag();
      cancelAnimationFrame(frame);
      clearWatch();
      windowObserver?.disconnect();
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
      listeners.length = 0;
      (canvasHost as HTMLElement & {stackObserver?: ResizeObserver}).stackObserver?.disconnect();
      for (const mesh of meshes) discardBlockMesh(mesh);
      meshes.length = 0;
      for (const item of proceduralMaterials) {
        try {
          if (typeof item.dispose === "function") item.dispose();
        } catch {}
      }
      proceduralMaterials.length = 0;
      world?.free();
      world = null;
      const canvas = renderer?.domElement;
      renderer?.dispose();
      renderer = null;
      canvas?.remove();
      scene = null;
      camera = null;
      centerGuide = null;
      audio.dispose();
      element.replaceChildren();
    },
  };
}
