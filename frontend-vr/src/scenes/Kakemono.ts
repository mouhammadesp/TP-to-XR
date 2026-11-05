/**
 * Kakemono — one roll-up banner stand next to the central workbench, whose
 * print changes with the selected specialty (menu) or the loaded TP's domain.
 *
 *   mechanical → kakemono/Mecanique.jpeg      electrical → kakemono/Electrique.jpeg
 *   chemical   → kakemono/Chimie.jpeg         biological → kakemono/Biologie.jpeg
 *   other / none / missing file → neutral print (generated)
 *
 * The prints are 1:2 portrait images: the banner is 0.85 × 1.70 m, so they are
 * shown without cropping or distortion. Unlit material (no reflections, no
 * shading gradient) for readability in the headset.
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { FONT } from "../ui/textCanvas";

const PRINT_W = 0.85;
const PRINT_H = 1.7; // 1:2, the ratio of the prints
const BASE_H = 0.09;
const KAKEMONO_DIR = "./textures/kakemono/";

/** Where the stand is: beside the bench, outside the yellow work-area marking, facing the student. */
const POSITION = new Vector3(2.75, 0, -0.6);
const FACING = new Vector3(0, 0, 4); // the student's spawn point

export const KAKEMONO_FILES: Record<string, string> = {
  mechanical: "Mecanique.jpeg",
  electrical: "Electrique.jpeg",
  chemical: "Chimie.jpeg",
  biological: "Biologie.jpeg",
};

export class Kakemono {
  private readonly material: StandardMaterial;
  private readonly root: TransformNode;
  private current: string | null | undefined = undefined;
  private texture: Texture | null = null;
  private neutral: DynamicTexture | null = null;

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("kakemono", scene);
    this.root.position.copyFrom(POSITION);
    const v = FACING.subtract(POSITION);
    this.root.rotation.y = Math.atan2(v.x, v.z); // local +Z (the print's front) toward the student

    const alu = new PBRMaterial("kakemono_alu", scene);
    alu.albedoColor = Color3.FromHexString("#C9CED3").toLinearSpace();
    alu.metallic = 0.85;
    alu.roughness = 0.35;
    alu.usePhysicalLightFalloff = false;
    const dark = new PBRMaterial("kakemono_dark", scene);
    dark.albedoColor = Color3.FromHexString("#2B2F33").toLinearSpace();
    dark.metallic = 0.2;
    dark.roughness = 0.6;
    dark.usePhysicalLightFalloff = false;

    // Cassette on the floor + two stabilizer feet.
    this.part(MeshBuilder.CreateBox("kakemono_base", { width: PRINT_W + 0.07, height: BASE_H, depth: 0.2 }, scene), [0, BASE_H / 2, 0], alu);
    for (const x of [-0.36, 0.36]) {
      this.part(MeshBuilder.CreateBox("kakemono_foot", { width: 0.04, height: 0.02, depth: 0.34 }, scene), [x, 0.01, 0], dark);
    }
    // Telescopic pole behind the print, top tension rail with end caps.
    const pole = MeshBuilder.CreateCylinder("kakemono_pole", { diameter: 0.016, height: PRINT_H + 0.02, tessellation: 12 }, scene);
    this.part(pole, [0, BASE_H + PRINT_H / 2, -0.035], alu);
    const rail = MeshBuilder.CreateCylinder("kakemono_rail", { diameter: 0.024, height: PRINT_W + 0.04, tessellation: 16 }, scene);
    rail.rotation.z = Math.PI / 2;
    this.part(rail, [0, BASE_H + PRINT_H + 0.008, 0], alu);
    for (const x of [-(PRINT_W / 2 + 0.025), PRINT_W / 2 + 0.025]) {
      const cap = MeshBuilder.CreateCylinder("kakemono_cap", { diameter: 0.03, height: 0.012, tessellation: 16 }, scene);
      cap.rotation.z = Math.PI / 2;
      this.part(cap, [x, BASE_H + PRINT_H + 0.008, 0], dark);
    }

    // The print (front) and its plain back.
    this.material = new StandardMaterial("kakemono_print", scene);
    this.material.disableLighting = true; // no shading, no specular reflection: readable from any angle
    const print = MeshBuilder.CreatePlane("kakemono_print", { width: PRINT_W, height: PRINT_H }, scene);
    print.rotation.y = Math.PI; // planes face -Z by default → turn the image toward local +Z
    this.part(print, [0, BASE_H + PRINT_H / 2, 0.002], this.material);
    const backMat = new StandardMaterial("kakemono_back", scene);
    backMat.diffuseColor = Color3.FromHexString("#D9DADC");
    backMat.specularColor = Color3.Black();
    const back = MeshBuilder.CreatePlane("kakemono_back", { width: PRINT_W, height: PRINT_H }, scene);
    this.part(back, [0, BASE_H + PRINT_H / 2, -0.002], backMat);

    this.root.getChildMeshes().forEach((m) => {
      m.isPickable = false;
      m.freezeWorldMatrix();
    });
    this.setDomain(null);
  }

  /**
   * Shows the print of a specialty (null / unknown / missing file → neutral print).
   * Only the texture changes; the stand is the same object.
   */
  public setDomain(domain: string | null): void {
    const file = domain ? KAKEMONO_FILES[domain] ?? null : null;
    if (file === this.current) return;
    this.current = file;
    if (!file) {
      this.showNeutral();
      return;
    }
    const tex = new Texture(
      KAKEMONO_DIR + file,
      this.scene,
      false,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        if (this.current !== file) return tex.dispose(); // a newer choice won the race
        this.swap(tex);
        console.log(`🪧 Kakémono : ${file}`);
      },
      () => {
        if (this.current !== file) return;
        console.warn(`🪧 Kakémono : ${file} introuvable → visuel neutre`);
        this.showNeutral();
      }
    );
    tex.anisotropicFilteringLevel = 16;
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  }

  /** The file currently shown (null = neutral print). Used by the tests. */
  public get shownFile(): string | null {
    return this.texture ? this.current ?? null : null;
  }

  private swap(tex: Texture): void {
    const old = this.texture;
    this.texture = tex;
    this.material.emissiveTexture = tex;
    old?.dispose(); // one print in GPU memory at a time
  }

  /** Neutral print (generated once): project identity, no specialty. */
  private showNeutral(): void {
    if (!this.neutral) {
      const w = 512;
      const h = 1024;
      const t = new DynamicTexture("kakemono_neutral", { width: w, height: h }, this.scene, true);
      const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#F4F7FB");
      g.addColorStop(1, "#DCE6F2");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#0B2F5B";
      ctx.textAlign = "center";
      ctx.font = `bold 74px ${FONT}`;
      ctx.fillText("TP-to-xR", w / 2, 300);
      ctx.font = `34px ${FONT}`;
      ctx.fillText("Laboratoire de", w / 2, 400);
      ctx.fillText("travaux pratiques", w / 2, 445);
      ctx.fillText("en réalité virtuelle", w / 2, 490);
      ctx.fillStyle = "#1E78C8";
      ctx.fillRect(w / 2 - 80, 540, 160, 6);
      ctx.fillStyle = "#3A4A5C";
      ctx.font = `30px ${FONT}`;
      ctx.fillText("CURI · UCAD", w / 2, 900);
      t.update();
      t.anisotropicFilteringLevel = 16;
      this.neutral = t;
    }
    const old = this.texture;
    this.texture = null;
    this.material.emissiveTexture = this.neutral;
    old?.dispose();
  }

  private part(mesh: Mesh, at: [number, number, number], mat: StandardMaterial | PBRMaterial): void {
    mesh.parent = this.root;
    mesh.position = new Vector3(...at);
    mesh.material = mat;
  }
}
