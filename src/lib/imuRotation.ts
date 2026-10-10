// IMU 3D 的姿态合成：四元数输入、叠加旋转，以及与欧拉角（ZYX，即 Yaw→Pitch→Roll）的互转。
// 无依赖的纯函数，便于脚本直接测试。
import type { ImuOrientation } from "./imuFusion";

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** 叠加旋转的一个分量：取某个通道的值，或固定数值 */
export interface ImuRotationComponent {
  source: "channel" | "constant";
  channel: string;
  value: number;
}

export interface ImuOverlayConfig {
  overlayEnabled: boolean;
  overlayMode: "euler" | "quat";
  /** local：在本体坐标系叠加（输入 × 叠加）；world：在世界坐标系叠加（叠加 × 输入） */
  overlayOrder: "local" | "world";
  overlayAngleUnit: "deg" | "rad";
  /** Roll / Pitch / Yaw */
  overlayEuler: ImuRotationComponent[];
  /** W / X / Y / Z */
  overlayQuat: ImuRotationComponent[];
}

export interface ImuQuaternionInputConfig {
  quatWChannel: string;
  quatXChannel: string;
  quatYChannel: string;
  quatZChannel: string;
}

const DEG = Math.PI / 180;

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** 归一化；模长接近 0（设备还没输出有效姿态）时返回 null */
export function normalizeQuaternion(q: Quaternion): Quaternion | null {
  const norm = Math.hypot(q.w, q.x, q.y, q.z);
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  return { w: q.w / norm, x: q.x / norm, y: q.y / norm, z: q.z / norm };
}

/** 欧拉角（度）转四元数，按 Z(yaw)·Y(pitch)·X(roll) 的顺序，与 3D 视图的旋转顺序一致 */
export function quaternionFromEuler({ roll, pitch, yaw }: ImuOrientation): Quaternion {
  const [cr, sr] = [Math.cos((roll * DEG) / 2), Math.sin((roll * DEG) / 2)];
  const [cp, sp] = [Math.cos((pitch * DEG) / 2), Math.sin((pitch * DEG) / 2)];
  const [cy, sy] = [Math.cos((yaw * DEG) / 2), Math.sin((yaw * DEG) / 2)];
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}

/** 四元数转欧拉角（度），ZYX 顺序；Pitch 到 ±90° 时 Roll/Yaw 合并，但合成的姿态不变 */
export function eulerFromQuaternion(q: Quaternion): ImuOrientation {
  const sinPitch = Math.max(-1, Math.min(1, 2 * (q.w * q.y - q.z * q.x)));
  return {
    roll: Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) / DEG,
    pitch: Math.asin(sinPitch) / DEG,
    yaw: Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) / DEG,
  };
}

/** 读取四元数通道；缺通道时把缺的 key 记进 missing */
export function readQuaternionInput(
  config: ImuQuaternionInputConfig,
  values: Record<string, number>,
  missing: string[]
): Quaternion | null {
  const keys = [config.quatWChannel, config.quatXChannel, config.quatYChannel, config.quatZChannel];
  const [w, x, y, z] = keys.map((key) => values[key]);
  keys.forEach((key, index) => {
    if (!Number.isFinite([w, x, y, z][index])) missing.push(key || "（未绑定）");
  });
  if (![w, x, y, z].every(Number.isFinite)) return null;
  return normalizeQuaternion({ w, x, y, z });
}

function readComponents(components: ImuRotationComponent[], values: Record<string, number>, missing: string[]) {
  const result = components.map((component) =>
    component.source === "constant" ? component.value : values[component.channel]
  );
  components.forEach((component, index) => {
    if (!Number.isFinite(result[index])) missing.push(component.channel || "（未绑定）");
  });
  return result.every(Number.isFinite) ? result : null;
}

/** 叠加旋转本身；未启用时返回单位四元数 */
export function resolveOverlayQuaternion(
  config: ImuOverlayConfig,
  values: Record<string, number>,
  missing: string[]
): Quaternion | null {
  if (config.overlayMode === "quat") {
    const parts = readComponents(config.overlayQuat, values, missing);
    return parts && normalizeQuaternion({ w: parts[0], x: parts[1], y: parts[2], z: parts[3] });
  }
  const parts = readComponents(config.overlayEuler, values, missing);
  if (!parts) return null;
  const factor = config.overlayAngleUnit === "rad" ? 1 / DEG : 1;
  return quaternionFromEuler({ roll: parts[0] * factor, pitch: parts[1] * factor, yaw: parts[2] * factor });
}

/** 把叠加旋转合成到输入姿态上 */
export function composeOverlay(input: Quaternion, overlay: Quaternion, order: ImuOverlayConfig["overlayOrder"]) {
  return order === "local" ? multiplyQuaternions(input, overlay) : multiplyQuaternions(overlay, input);
}
