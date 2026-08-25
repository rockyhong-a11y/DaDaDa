import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { SkyPreset } from './palette';

export type Quality = 'low' | 'medium' | 'high';

/** 렌더러 · 컴포저 · 조명을 묶어 스테이지 간에 재사용한다. */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sun: DirectionalLight;
  /** 캐릭터 실루엣을 살리는 역광 */
  readonly rim: DirectionalLight;
  readonly ambient: AmbientLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private qualityLevel: Quality = 'high';
  private camera: PerspectiveCamera | null = null;
  private preset: SkyPreset | null = null;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(new Color(0x05060f), 1);

    this.sun = new DirectionalLight(0xffffff, 2);
    this.rim = new DirectionalLight(0x7fd8ff, 1.1);
    this.ambient = new AmbientLight(0xffffff, 0.6);
    this.scene.add(this.sun, this.rim, this.ambient);
  }

  setCamera(camera: PerspectiveCamera): void {
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
  }

  applyPreset(preset: SkyPreset): void {
    this.preset = preset;
    this.sun.color.copy(preset.sunColor);
    this.sun.intensity = preset.sunIntensity * 0.9;
    this.sun.position.set(...preset.sunDir).normalize().multiplyScalar(1000);
    this.rim.position.set(...preset.sunDir).normalize().multiplyScalar(-800);
    this.rim.position.y = Math.abs(this.rim.position.y) + 300;
    this.rim.color.copy(preset.cityGlow).lerp(new Color(0x7fd8ff), 0.5);
    this.ambient.color.copy(preset.ambient);
    this.ambient.intensity = preset.ambientIntensity * 1.4;
    this.renderer.toneMappingExposure = preset.exposure;
    if (this.bloom) this.bloom.strength = preset.bloom * this.bloomScale();
  }

  private bloomScale(): number {
    return this.qualityLevel === 'high' ? 1 : this.qualityLevel === 'medium' ? 0.75 : 0;
  }

  get quality(): Quality {
    return this.qualityLevel;
  }

  /** 캔버스의 CSS 크기. 모바일 툴바 때문에 window.innerHeight 와 다를 수 있다. */
  get width(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  setQuality(q: Quality): void {
    this.qualityLevel = q;
    const dpr = window.devicePixelRatio || 1;
    let cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    // 총 픽셀 수 상한. 고해상도 폰에서 DPR 3 으로 그리면 셰이딩 비용이 감당이 안 된다.
    const budget = q === 'high' ? 4.2e6 : q === 'medium' ? 2.6e6 : 1.5e6;
    const area = Math.max(1, this.width * this.height);
    cap = Math.min(cap, Math.sqrt(budget / area));
    this.renderer.setPixelRatio(Math.max(0.6, Math.min(dpr, cap)));
    if (q === 'low') {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
      this.renderPass = null;
    } else if (!this.composer && this.camera) {
      this.buildComposer(this.camera);
    }
    if (this.preset) this.applyPreset(this.preset);
    this.resize();
  }

  private buildComposer(camera: PerspectiveCamera): void {
    const size = this.renderer.getSize(new Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, camera);
    this.bloom = new UnrealBloomPass(size, this.preset ? this.preset.bloom : 0.5, 0.6, 1.0);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  ensureComposer(camera: PerspectiveCamera): void {
    this.camera = camera;
    if (this.qualityLevel !== 'low' && !this.composer) this.buildComposer(camera);
    else if (this.renderPass) this.renderPass.camera = camera;
  }

  resize(): void {
    const w = this.width;
    const h = this.height;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    // 픽셀 예산은 화면 크기에 따라 달라지므로 크기가 바뀌면 다시 계산한다
    this.setPixelBudget();
  }

  private setPixelBudget(): void {
    const dpr = window.devicePixelRatio || 1;
    const q = this.qualityLevel;
    let cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    const budget = q === 'high' ? 4.2e6 : q === 'medium' ? 2.6e6 : 1.5e6;
    const area = Math.max(1, this.width * this.height);
    cap = Math.min(cap, Math.sqrt(budget / area));
    this.renderer.setPixelRatio(Math.max(0.6, Math.min(dpr, cap)));
  }

  render(camera: PerspectiveCamera): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
