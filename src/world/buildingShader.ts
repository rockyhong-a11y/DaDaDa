export const BUILDING_VERT = /* glsl */ `
  attribute vec3 aSize;
  attribute float aTint;
  attribute float aSeed;
  attribute float aKind;

  varying vec3 vLocal;
  varying vec3 vNormalO;
  varying vec3 vSize;
  varying float vTint;
  varying float vSeed;
  varying float vKind;
  varying float vDist;
  varying vec3 vWorld;

  void main() {
    vLocal = position;
    vNormalO = normal;
    vSize = aSize;
    vTint = aTint;
    vSeed = aSeed;
    vKind = aKind;

    #ifdef USE_INSTANCING
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 n = mat3(instanceMatrix) * normal;
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec3 n = normal;
    #endif
    vWorld = world.xyz;
    vNormalO = normalize(mat3(modelMatrix) * n);
    vec4 mv = viewMatrix * world;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const BUILDING_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vLocal;
  varying vec3 vNormalO;
  varying vec3 vSize;
  varying float vTint;
  varying float vSeed;
  varying float vKind;
  varying float vDist;
  varying vec3 vWorld;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uAmbient;
  uniform float uAmbientIntensity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uWindowLit;
  uniform float uWindowGlow;
  uniform float uTime;
  uniform vec3 uGroundTint;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 n = normalize(vNormalO);
    bool isRoof = abs(n.y) > 0.55;

    // --- 외벽 바탕색 ---
    // kind: 0 아파트, 1 오피스, 2 저층, 3 랜드마크
    vec3 apt = mix(vec3(0.20, 0.19, 0.18), vec3(0.30, 0.28, 0.26), vTint);
    vec3 off = mix(vec3(0.075, 0.085, 0.115), vec3(0.13, 0.145, 0.18), vTint);
    vec3 low = mix(vec3(0.13, 0.12, 0.115), vec3(0.21, 0.185, 0.165), vTint);
    vec3 lmk = vec3(0.10, 0.115, 0.145);
    vec3 base = vKind < 0.5 ? apt : (vKind < 1.5 ? off : (vKind < 2.5 ? low : lmk));

    float emissive = 0.0;
    vec3 emColor = vec3(1.0);

    if (!isRoof) {
      // 면 위의 미터 단위 좌표
      float u = abs(n.x) > 0.5 ? vLocal.z * vSize.z : vLocal.x * vSize.x;
      float v = (vLocal.y + 0.5) * vSize.y;

      // 용도별 창문 격자 간격
      float pitchU = vKind < 0.5 ? 3.7 : (vKind < 1.5 ? 3.0 : (vKind < 2.5 ? 3.3 : 3.1));
      float pitchV = vKind < 0.5 ? 3.1 : (vKind < 1.5 ? 3.55 : (vKind < 2.5 ? 3.4 : 3.9));

      float cu = floor(u / pitchU);
      float cv = floor(v / pitchV);
      vec2 f = vec2(fract(u / pitchU), fract(v / pitchV));

      // 한 픽셀이 창 격자 몇 칸을 덮는가. 1 에 가까워지면 격자를 그릴 수 없다.
      // 거리 대신 이 값으로 디테일을 끄면 어느 각도에서도 지글거리지 않는다.
      float px = max(fwidth(u) / pitchU, fwidth(v) / pitchV);
      float detail = 1.0 - smoothstep(0.22, 0.62, px);

      // 창틀 (해상도 기반 안티에일리어싱)
      vec2 w = min(fwidth(f) * 1.2, vec2(0.4)) + 0.002;
      float mx = smoothstep(0.10 - w.x, 0.10 + w.x, f.x) * (1.0 - smoothstep(0.86 - w.x, 0.86 + w.x, f.x));
      float my = smoothstep(0.16 - w.y, 0.16 + w.y, f.y) * (1.0 - smoothstep(0.80 - w.y, 0.80 + w.y, f.y));
      float win = mx * my;

      // 저층부(1~2층)는 상가 → 대체로 밝다
      bool podium = v < pitchV * 1.6;

      float r = hash13(vec3(cu + 31.0, cv, mod(vSeed * 7.0, 311.0) + (abs(n.x) > 0.5 ? 5.0 : 0.0)));
      float litRatio = uWindowLit * (vKind < 0.5 ? 1.15 : 1.0) * (vKind > 2.5 ? 1.25 : 1.0);
      float lit = step(r, clamp(litRatio, 0.0, 1.0));
      // 켜진 창이라고 다 같은 밝기는 아니다. 블라인드·커튼으로 절반쯤은 흐릿하다.
      float dim = 0.35 + 0.65 * hash13(vec3(cu * 5.0, cv * 2.0, mod(vSeed * 3.0, 173.0)));
      lit *= dim;
      if (podium) lit = max(lit, 0.55);

      // 아주 느린 점멸 (사람이 사는 느낌)
      float flick = step(0.988, hash13(vec3(cu, cv, floor(uTime * 0.6) + mod(vSeed, 97.0))));
      lit *= (1.0 - flick * 0.8);

      // 창문 색: 백색·전구색·형광색이 섞이게
      float ct = hash13(vec3(cu * 3.0, cv * 7.0, vSeed * 5.0));
      vec3 warm = vec3(1.0, 0.80, 0.50);
      vec3 neutral = vec3(0.92, 0.95, 1.0);
      vec3 cool = vec3(0.62, 0.86, 1.0);
      emColor = ct < 0.55 ? warm : (ct < 0.88 ? neutral : cool);

      // 창유리 자체는 하늘을 반사해 조금 어둡고 푸르다
      vec3 glass = mix(base * 0.5, vec3(0.055, 0.075, 0.125), 0.55);
      base = mix(base, glass, win * detail * 0.9);

      float ratio = clamp(litRatio, 0.0, 1.0);
      emissive = win * lit * uWindowGlow * detail;
      // 격자를 그릴 수 없는 거리에서는 건물 전체가 은은하게 빛나 보이게 뭉갠다
      emissive += (1.0 - detail) * uWindowGlow * ratio * 0.11;
      emColor = mix(vec3(0.98, 0.86, 0.68), emColor, detail);
    } else {
      // 옥상: 방수도료 + 설비 그림자
      float px = max(fwidth(vLocal.x * vSize.x), fwidth(vLocal.z * vSize.z)) / 4.0;
      float detail = 1.0 - smoothstep(0.25, 0.7, px);
      float g = hash13(vec3(floor(vLocal.x * vSize.x / 4.0), floor(vLocal.z * vSize.z / 4.0), mod(vSeed, 89.0)));
      base = mix(base * 0.78, base * 1.2, mix(0.5, g, detail));
      base = mix(base, uGroundTint * 0.5, 0.1);
    }

    // --- 조명 ---
    // 해를 받는 면은 따뜻하게, 그늘진 면은 하늘색 환경광만 받아 차갑게.
    // 이 대비가 없으면 도시 전체가 한 가지 색으로 뭉개진다.
    vec3 L = normalize(uSunDir);
    float ndl = max(dot(n, L), 0.0);
    float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
    vec3 lightCol = uSunColor * uSunIntensity * (ndl * 0.92 + wrap * wrap * 0.12);
    vec3 amb = uAmbient * uAmbientIntensity * (0.42 + 0.58 * max(n.y * 0.5 + 0.5, 0.0));
    // 지면 반사광 (도시의 주황 광공해)
    amb += uGroundTint * 0.35 * max(-n.y * 0.5 + 0.5, 0.0) * smoothstep(180.0, 0.0, vWorld.y);

    vec3 col = base * (lightCol + amb);
    col += emColor * emissive;

    // --- 지수 안개 ---
    float fog = 1.0 - exp(-uFogDensity * vDist * 0.8);
    // 고도가 높을수록 안개가 옅다
    fog *= clamp(1.0 - (vWorld.y - 40.0) / 900.0, 0.25, 1.0);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;
