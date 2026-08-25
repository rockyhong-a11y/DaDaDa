import { Matrix4, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { DEG2RAD } from './geo';
import type { LatLon } from './geo';

/**
 * Google Photorealistic 3D Tiles 배경 레이어 (실험적).
 *
 * 사용자가 자기 Google Maps API 키를 넣으면 실제 서울의 실사 3D 타일을
 * 게임 좌표계에 정합해 띄운다. 키가 없으면 이 모듈은 아예 로드되지 않고,
 * 실제 좌표로 생성한 자체 도시 모델로 플레이한다.
 *
 * 주의: 게임의 앵커·비행 고도는 자체 도시 모델에서 계산하므로,
 * 실사 타일과 완벽히 일치하지는 않는다. 배경 레이어로만 쓴다.
 */
export class GoogleTilesLayer {
  private tiles: {
    group: import('three').Object3D;
    errorTarget: number;
    setCamera(c: PerspectiveCamera): boolean;
    setResolutionFromRenderer(c: PerspectiveCamera, r: WebGLRenderer): boolean;
    update(): void;
    dispose(): void;
  } | null = null;
  private disposed = false;

  private constructor(private readonly scene: Scene) {}

  /**
   * 타일 레이어를 만든다. 실패하면 null 을 돌려주고 게임은 자체 도시로 계속된다.
   * 3d-tiles-renderer 는 동적 import 라 키가 없을 땐 번들 로드조차 하지 않는다.
   */
  static async create(
    scene: Scene,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
    origin: LatLon,
    apiToken: string,
  ): Promise<GoogleTilesLayer | null> {
    if (!apiToken) return null;
    try {
      const [{ TilesRenderer, WGS84_ELLIPSOID }, plugins] = await Promise.all([
        import('3d-tiles-renderer'),
        import('3d-tiles-renderer/plugins'),
      ]);
      const layer = new GoogleTilesLayer(scene);

      const tiles = new TilesRenderer();
      tiles.registerPlugin(new plugins.GoogleCloudAuthPlugin({ apiToken, autoRefreshToken: true }));
      tiles.registerPlugin(new plugins.TileCompressionPlugin());
      tiles.registerPlugin(new plugins.TilesFadePlugin());
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      // 화면 오차 허용치. 리듬 게임은 초당 30m 씩 이동하므로
      // 디테일보다 로딩 지연을 줄이는 쪽이 낫다.
      tiles.errorTarget = 32;

      // ECEF -> 스테이지 원점 기준 ENU -> three.js Y-up 좌표계
      const frame = new Matrix4();
      WGS84_ELLIPSOID.getEastNorthUpFrame(origin.lat * DEG2RAD, origin.lon * DEG2RAD, 0, frame);
      frame.invert();
      const group = tiles.group;
      group.matrixAutoUpdate = false;
      group.matrix.makeRotationX(-Math.PI / 2).multiply(frame);
      group.matrixWorldNeedsUpdate = true;
      group.renderOrder = -20;

      scene.add(group);
      layer.tiles = tiles as unknown as GoogleTilesLayer['tiles'];
      return layer;
    } catch (err) {
      console.warn('[3D Tiles] 로드 실패, 자체 도시 모델로 진행합니다:', err);
      return null;
    }
  }

  update(): void {
    if (this.disposed) return;
    this.tiles?.update();
  }

  resize(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
    this.tiles?.setResolutionFromRenderer(camera, renderer);
  }

  dispose(): void {
    if (this.disposed || !this.tiles) return;
    this.disposed = true;
    this.scene.remove(this.tiles.group);
    this.tiles.dispose();
    this.tiles = null;
  }
}
