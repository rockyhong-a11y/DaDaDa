import { Color } from 'three';
import type { StageDef } from '../data/types';

export interface SkyPreset {
  zenith: Color;
  horizon: Color;
  ground: Color;
  /** 도시 야간 광공해 색 */
  cityGlow: Color;
  sunDir: [number, number, number];
  sunColor: Color;
  sunIntensity: number;
  ambient: Color;
  ambientIntensity: number;
  fogColor: Color;
  fogDensity: number;
  /** 창문 점등 비율 0~1 */
  windowLit: number;
  /** 창문 발광 세기 */
  windowGlow: number;
  starIntensity: number;
  waterColor: Color;
  exposure: number;
  bloom: number;
}

const c = (hex: number): Color => new Color(hex);

export const SKY_PRESETS: Record<StageDef['timeOfDay'], SkyPreset> = {
  sunset: {
    zenith: c(0x1d2f6f),
    horizon: c(0xff8f52),
    ground: c(0x3a2a34),
    cityGlow: c(0xffb070),
    sunDir: [-0.72, 0.16, -0.68],
    sunColor: c(0xffc08a),
    sunIntensity: 1.75,
    ambient: c(0x4f6bb4),
    ambientIntensity: 0.95,
    fogColor: c(0xc4855f),
    fogDensity: 0.00030,
    windowLit: 0.16,
    windowGlow: 0.62,
    starIntensity: 0,
    waterColor: c(0x2c3f66),
    exposure: 1.02,
    bloom: 0.34,
  },
  dusk: {
    zenith: c(0x0e1636),
    horizon: c(0xff5f8d),
    ground: c(0x241d3c),
    cityGlow: c(0xff8fb0),
    sunDir: [0.78, 0.08, -0.62],
    sunColor: c(0xff9aa8),
    sunIntensity: 1.35,
    ambient: c(0x42509a),
    ambientIntensity: 0.9,
    fogColor: c(0x6a4a72),
    fogDensity: 0.00042,
    windowLit: 0.3,
    windowGlow: 0.95,
    starIntensity: 0.25,
    waterColor: c(0x1c2547),
    exposure: 1.05,
    bloom: 0.48,
  },
  night: {
    zenith: c(0x03050e),
    horizon: c(0x14204a),
    ground: c(0x141724),
    cityGlow: c(0xffa251),
    sunDir: [0.35, 0.5, -0.78],
    sunColor: c(0x9db3ff),
    sunIntensity: 0.5,
    ambient: c(0x27356b),
    ambientIntensity: 0.62,
    fogColor: c(0x0e1732),
    fogDensity: 0.0005,
    windowLit: 0.34,
    windowGlow: 0.9,
    starIntensity: 1,
    waterColor: c(0x080e20),
    exposure: 1.15,
    bloom: 0.62,
  },
  dawn: {
    zenith: c(0x101a44),
    horizon: c(0xffb887),
    ground: c(0x272738),
    cityGlow: c(0xffc79a),
    sunDir: [0.85, 0.1, 0.5],
    sunColor: c(0xffd7ae),
    sunIntensity: 1.45,
    ambient: c(0x4b63ab),
    ambientIntensity: 0.95,
    fogColor: c(0x9fa8c8),
    fogDensity: 0.00046,
    windowLit: 0.2,
    windowGlow: 0.78,
    starIntensity: 0.12,
    waterColor: c(0x35456e),
    exposure: 1.0,
    bloom: 0.4,
  },
  day: {
    zenith: c(0x2a6ad4),
    horizon: c(0xbcd6f2),
    ground: c(0x2a2a30),
    cityGlow: c(0xdde8ff),
    sunDir: [0.4, 0.8, -0.45],
    sunColor: c(0xffffff),
    sunIntensity: 2.6,
    ambient: c(0x9ab4dd),
    ambientIntensity: 1.0,
    fogColor: c(0xc3d3e8),
    fogDensity: 0.00028,
    windowLit: 0.08,
    windowGlow: 0.35,
    starIntensity: 0,
    waterColor: c(0x4a6fa0),
    exposure: 0.95,
    bloom: 0.3,
  },
};
