// IMU 3D 姿态合成：欧拉角 ↔ 四元数往返、四元数输入归一化、叠加旋转的两种合成顺序。
import assert from "node:assert/strict";
import {
  composeOverlay,
  eulerFromQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionFromEuler,
  readQuaternionInput,
  resolveOverlayQuaternion,
  type ImuOverlayConfig,
} from "../src/lib/imuRotation.ts";

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} 期望 ${expected}，实际 ${actual}`);
const closeEuler = (actual: { roll: number; pitch: number; yaw: number }, roll: number, pitch: number, yaw: number) => {
  close(actual.roll, roll, "roll");
  close(actual.pitch, pitch, "pitch");
  close(actual.yaw, yaw, "yaw");
};

// 欧拉角往返（避开 Pitch ±90° 的万向锁）
for (const angles of [
  { roll: 10, pitch: -20, yaw: 30 },
  { roll: -170, pitch: 45, yaw: 120 },
  { roll: 0, pitch: 0, yaw: -90 },
]) {
  closeEuler(eulerFromQuaternion(quaternionFromEuler(angles)), angles.roll, angles.pitch, angles.yaw);
}

// 单轴旋转：绕 Z 转 90° 的四元数
const yaw90 = quaternionFromEuler({ roll: 0, pitch: 0, yaw: 90 });
close(yaw90.w, Math.SQRT1_2);
close(yaw90.z, Math.SQRT1_2);

// 归一化与无效输入
const scaled = normalizeQuaternion({ w: 2, x: 0, y: 0, z: 0 })!;
assert.deepEqual(scaled, { w: 1, x: 0, y: 0, z: 0 });
assert.equal(normalizeQuaternion({ w: 0, x: 0, y: 0, z: 0 }), null);

// 四元数输入按分量绑定；缺通道时列出 key
const input = { quatWChannel: "qw", quatXChannel: "qx", quatYChannel: "qy", quatZChannel: "qz" };
const missing: string[] = [];
const read = readQuaternionInput(input, { qw: 0, qx: 0, qy: 0, qz: 2 }, missing)!;
closeEuler(eulerFromQuaternion(read), 0, 0, 180);
assert.deepEqual(missing, []);
assert.equal(readQuaternionInput(input, { qw: 1, qx: 0 }, missing), null);
assert.deepEqual(missing, ["qy", "qz"]);

// 叠加旋转：固定值 + 通道
const overlay: ImuOverlayConfig = {
  overlayEnabled: true,
  overlayMode: "euler",
  overlayOrder: "local",
  overlayAngleUnit: "deg",
  overlayEuler: [
    { source: "constant", channel: "", value: 0 },
    { source: "constant", channel: "", value: 0 },
    { source: "channel", channel: "motor", value: 0 },
  ],
  overlayQuat: [],
};
const overlayMissing: string[] = [];
const motor = resolveOverlayQuaternion(overlay, { motor: 30 }, overlayMissing)!;
closeEuler(eulerFromQuaternion(motor), 0, 0, 30);
assert.equal(resolveOverlayQuaternion(overlay, {}, overlayMissing), null);
assert.deepEqual(overlayMissing, ["motor"]);
// 弧度单位
const radians = resolveOverlayQuaternion({ ...overlay, overlayAngleUnit: "rad" }, { motor: Math.PI / 2 }, [])!;
closeEuler(eulerFromQuaternion(radians), 0, 0, 90);
// 四元数叠加同样归一化
const quatOverlay = resolveOverlayQuaternion(
  {
    ...overlay,
    overlayMode: "quat",
    overlayQuat: [1, 0, 0, 1].map((value) => ({ source: "constant" as const, channel: "", value })),
  },
  {},
  []
)!;
closeEuler(eulerFromQuaternion(quatOverlay), 0, 0, 90);

// 同轴旋转两种顺序结果相同：Yaw 30° 叠加 Yaw 30° = 60°
closeEuler(eulerFromQuaternion(composeOverlay(motor, motor, "local")), 0, 0, 60);

// 不同轴时顺序有区别：输入 Roll 90°，叠加 Yaw 90°
const roll90 = quaternionFromEuler({ roll: 90, pitch: 0, yaw: 0 });
const local = eulerFromQuaternion(composeOverlay(roll90, yaw90, "local"));
const world = eulerFromQuaternion(composeOverlay(roll90, yaw90, "world"));
// 世界坐标系：先 Roll 再绕固定 Z 转 → 等价于 ZYX 欧拉角 (90, 0, 90)
closeEuler(world, 90, 0, 90);
assert.ok(Math.abs(local.yaw - world.yaw) > 1 || Math.abs(local.pitch - world.pitch) > 1, "两种顺序应得到不同姿态");
// 本体坐标系 = 输入 × 叠加
const product = multiplyQuaternions(roll90, yaw90);
closeEuler(local, ...(Object.values(eulerFromQuaternion(product)) as [number, number, number]));

console.log("IMU 姿态合成检查通过");
