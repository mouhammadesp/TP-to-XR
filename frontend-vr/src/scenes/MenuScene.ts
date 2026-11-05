/**
 * MenuScene — 3D background behind the menus: the empty workshop, seen from a
 * camera slowly circling the workbench. It reuses the already-loaded scene
 * (no second scene, no reload); stop() puts the camera back at the student's
 * spawn point with walking controls.
 */
import { Nullable, Observer, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";

const CENTER = new Vector3(0, 1, 0);
const RADIUS = 5.5;
const HEIGHT = 2.4;
/** Radians per second (one turn ≈ 80 s). */
const SPEED = 0.08;

export class MenuScene {
  private observer: Nullable<Observer<Scene>> = null;
  private readonly spawnPosition: Vector3;
  private readonly spawnTarget: Vector3;
  private readonly flags: { collisions: boolean; gravity: boolean };

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly canvas: HTMLCanvasElement
  ) {
    this.spawnPosition = camera.position.clone();
    this.spawnTarget = camera.getTarget().clone();
    this.flags = { collisions: camera.checkCollisions, gravity: camera.applyGravity };
  }

  /** Starts the orbit (static view if the user prefers reduced motion). */
  public start(): void {
    this.camera.detachControl();
    this.camera.checkCollisions = false;
    this.camera.applyGravity = false;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const t0 = performance.now();
    const place = (angle: number) => {
      this.camera.position.set(Math.sin(angle) * RADIUS, HEIGHT, Math.cos(angle) * RADIUS);
      this.camera.setTarget(CENTER);
    };
    place(0.6);
    if (!still) {
      this.observer = this.scene.onBeforeRenderObservable.add(() => place(0.6 + ((performance.now() - t0) / 1000) * SPEED));
    }
  }

  /** Stops the orbit and gives the student the spawn view and controls. */
  public stop(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.observer = null;
    this.camera.position.copyFrom(this.spawnPosition);
    this.camera.setTarget(this.spawnTarget);
    this.camera.checkCollisions = this.flags.collisions;
    this.camera.applyGravity = this.flags.gravity;
    this.camera.attachControl(this.canvas, true);
  }
}
