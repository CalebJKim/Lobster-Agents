import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AgentInfo } from "../types";
import {
  makeLobster,
  makeCoralPatch,
  makeSeaweedPatch,
  makeAnemonePatch,
  makeBubbles,
} from "./ThreeUnderwaterMap";

interface Props {
  agent: AgentInfo;
  /** Tailwind class names applied to the canvas wrapper. Defaults to a
   *  bright tide-blue background with rounded corners. */
  className?: string;
}

/**
 * Standalone three.js mini-scene that renders one slowly-rotating 3D
 * lobster with a few pieces of reef decor — coral, seaweed, an anemone,
 * and drifting bubbles. Used by both LobsterDetailModal and LobsterBuilder
 * so the character-select-style preview stays in lockstep with how the
 * lobster looks in-world.
 */
export default function LobsterStage({ agent, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const generated = agent.appearance?.generated_headwear;
  const stageKey = [
    agent.color ?? "",
    agent.appearance?.headwear ?? "none",
    agent.appearance?.eyewear ?? "none",
    generated?.kind ?? "",
    generated?.primary ?? "",
    generated?.accent ?? "",
    JSON.stringify(generated?.decorations ?? []),
  ].join(":");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Bright shallow-reef background — pale tide blue with a brighter floor
    // so the lobster pops instead of disappearing into the dark.
    scene.background = new THREE.Color(0x9cd6e0);
    scene.fog = new THREE.Fog(0xb6e1e6, 6, 16);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 1.6, 6.2);
    camera.lookAt(0, 0.9, 0);

    const ambient = new THREE.AmbientLight(0xeaf7fb, 1.25);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x76b900, 0.55);
    rim.position.set(-3, 4, -3);
    scene.add(rim);

    // Soft sandy floor disc so the lobster casts a readable shadow.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 48),
      new THREE.MeshStandardMaterial({ color: 0xe7d6a3, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);

    // Cute reef decor. Positioned behind and to the sides of the lobster
    // (which sits at origin), tuned to the floor disc's footprint so
    // nothing clips off the edge. Same building blocks as the main map
    // so the modal looks consistent with the world.
    const coralA = makeCoralPatch(-1.85, -1.55, 0xff7f9a, 7, 0.7, 0.85);
    coralA.scale.set(0.6, 0.7, 0.6);
    scene.add(coralA);

    const coralB = makeCoralPatch(1.95, -1.7, 0xf2b96f, 7, 0.7, 0.95);
    coralB.scale.set(0.55, 0.65, 0.55);
    scene.add(coralB);

    const coralC = makeCoralPatch(0.4, -2.3, 0x6ed7cf, 6, 0.55, 0.75);
    coralC.scale.set(0.5, 0.55, 0.5);
    scene.add(coralC);

    const seaweedL = makeSeaweedPatch(-2.45, 0.4, 6, 0x47b99a);
    seaweedL.scale.set(0.6, 0.8, 0.6);
    scene.add(seaweedL);

    const seaweedR = makeSeaweedPatch(2.55, 0.0, 5, 0x2fa184);
    seaweedR.scale.set(0.55, 0.75, 0.55);
    scene.add(seaweedR);

    const anemone = makeAnemonePatch(-1.6, 1.6, 0xff7fb5);
    anemone.scale.set(0.55, 0.6, 0.55);
    scene.add(anemone);

    // Ambient bubble cloud — separate from the lobster's per-actor bubbles
    // so the rotation doesn't drag them in a circle.
    const ambientBubbles = makeBubbles(14, 4.2);
    ambientBubbles.position.set(0, 0, 0);
    scene.add(ambientBubbles);

    // The lobster itself — reuses the production mesh so the preview is
    // faithful to how the lobster will look in-world.
    const actor = makeLobster(agent);
    actor.group.position.set(0, 0, 0);
    actor.label.visible = false;
    actor.speech.visible = false;
    actor.ring.visible = false;
    actor.bubbles.visible = true;
    scene.add(actor.group);

    let frame = 0;
    let last = performance.now();
    const animate = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // Slow turntable rotation so every side comes into view.
      actor.group.rotation.y += dt * 0.32;
      // Video-game-character-select bob — bigger amplitude than the in-world
      // lobsters' twitch, with a hint of forward lean as it rises so it
      // feels alive instead of mechanical.
      const t = now * 0.002;
      actor.group.position.y = Math.sin(t) * 0.22 + 0.05;
      actor.group.rotation.z = Math.sin(t) * 0.05;
      // Drift the ambient bubbles upward and reset at the surface.
      ambientBubbles.children.forEach((b) => {
        b.position.y += dt * 0.32;
        if (b.position.y > 3.2) {
          b.position.y = 0.2;
        }
      });
      actor.bubbles.children.forEach((b) => {
        b.position.y += dt * 0.45;
        if (b.position.y > 2.6) b.position.y = 0.5;
      });
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    const handleResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      // Best-effort GPU cleanup — walk every mesh in the scene and dispose
      // its geometry/material. Materials shared across meshes will get
      // dispose() called multiple times which is a no-op the 2nd time.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat && "dispose" in mat) mat.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [stageKey]);

  return (
    <div
      ref={mountRef}
      className={className ?? "h-full w-full bg-[#9cd6e0]"}
      style={{ minHeight: 280 }}
    />
  );
}
