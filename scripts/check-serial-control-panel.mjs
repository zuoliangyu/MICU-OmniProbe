import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });

try {
  await server.ssrLoadModule("/src/components/serial/SerialSidebar.tsx");
  const {
    joystickPointFromRatio,
    parseSerialCommandSequence,
    parseSerialControlPanel,
    renderSerialControlCommand,
    renderSerialJoystickCommand,
    resolveSerialImuAngles,
    resolveSerialImuPose,
    clampFloatingPanelPosition,
    createSerialControlWidget,
    getSerialControlWidgetInputHelp,
    isSerialControlWidgetType,
    SERIAL_CONTROL_WIDGET_TYPES,
    SERIAL_CONTROL_WIDGET_DEFINITIONS,
    SERIAL_CONTROL_WIDGET_GROUPS,
  } = await server.ssrLoadModule("/src/lib/serialControlPanel.ts");
  const { buildSerialControlChartData } = await server.ssrLoadModule(
    "/src/components/serial/SerialControlMiniChart.tsx"
  );
  const { isSerialSendWidget } = await server.ssrLoadModule("/src/components/serial/SerialSendControlWidgets.tsx");
  const { isSerialDisplayWidget } = await server.ssrLoadModule(
    "/src/components/serial/SerialDisplayControlWidgets.tsx"
  );
  const { isSerialVisualizationWidget } = await server.ssrLoadModule(
    "/src/components/serial/SerialVisualizationControlWidgets.tsx"
  );
  const { createImuFusionState, estimateGyroBias, ImuFusionProcessor, updateImuFusion } =
    await server.ssrLoadModule("/src/lib/imuFusion.ts");
  const { parseHexBytes } = await server.ssrLoadModule("/src/lib/serialSend.ts");
  const { createSimulationSample, normalizeSimulationConfig, resolveSimulationSampleRange } =
    await server.ssrLoadModule("/src/lib/serialSimulation.ts");
  const { formatTimestamp } = await server.ssrLoadModule("/src/lib/formatters.ts");

  const timestamp = new Date(2026, 6, 24, 15, 44, 34, 123).getTime();
  assert.equal(formatTimestamp(timestamp), "15:44:34.123");
  assert.equal(formatTimestamp(timestamp, "YYYY年MM月DD日 HH:mm:ss"), "2026年07月24日 15:44:34");
  assert.equal(formatTimestamp(timestamp, "mm:ss"), "44:34");
  assert.equal(formatTimestamp(timestamp, ""), "15:44:34.123");
  assert.deepEqual(
    clampFloatingPanelPosition({ x: -999, y: 999 }, { width: 1000, height: 800 }, { width: 320, height: 600 }),
    { x: -656, y: 176 }
  );
  const widgetTypes = SERIAL_CONTROL_WIDGET_DEFINITIONS.map(({ type }) => type);
  assert.equal(widgetTypes.length, 15);
  assert.equal(new Set(widgetTypes).size, widgetTypes.length);
  assert.deepEqual(widgetTypes, SERIAL_CONTROL_WIDGET_TYPES);
  assert.deepEqual(
    SERIAL_CONTROL_WIDGET_GROUPS.flatMap(({ items }) => items.map(({ type }) => type)),
    widgetTypes
  );
  assert.equal(
    SERIAL_CONTROL_WIDGET_DEFINITIONS.every(({ type, label, inputHelp }) => {
      const widget = createSerialControlWidget(type);
      return widget.type === type && widget.label === label && inputHelp.docId === type;
    }),
    true
  );
  assert.equal(isSerialControlWidgetType("imu-3d"), true);
  assert.equal(isSerialControlWidgetType("unknown"), false);
  assert.equal(
    SERIAL_CONTROL_WIDGET_GROUPS[0].items.every(({ type }) => isSerialSendWidget(createSerialControlWidget(type))),
    true
  );
  assert.equal(isSerialSendWidget(createSerialControlWidget("gauge")), false);
  assert.equal(
    SERIAL_CONTROL_WIDGET_GROUPS[1].items.every(({ type }) => isSerialDisplayWidget(createSerialControlWidget(type))),
    true
  );
  assert.equal(isSerialDisplayWidget(createSerialControlWidget("yt-chart")), false);
  assert.equal(
    SERIAL_CONTROL_WIDGET_GROUPS[2].items.every(({ type }) =>
      isSerialVisualizationWidget(createSerialControlWidget(type))
    ),
    true
  );
  assert.equal(isSerialVisualizationWidget(createSerialControlWidget("button")), false);
  const imuHelpWidget = createSerialControlWidget("imu-3d");
  assert.equal(getSerialControlWidgetInputHelp(imuHelpWidget).example, '{"roll":10.2,"pitch":-3.1,"yaw":45}');
  assert.equal(
    getSerialControlWidgetInputHelp({ ...imuHelpWidget, sourceMode: "imu6" }).example,
    '{"ax":0.01,"ay":0.02,"az":1,"gx":0.2,"gy":-0.1,"gz":0}'
  );
  const importedDefaults = parseSerialControlPanel({
    version: 4,
    widgets: widgetTypes.map((type) => ({ type })),
  }).widgets;
  widgetTypes.forEach((type, index) => {
    const {
      id: _createdId,
      width: _createdWidth,
      height: _createdHeight,
      ...created
    } = createSerialControlWidget(type);
    const { id: _importedId, width: _importedWidth, height: _importedHeight, ...imported } = importedDefaults[index];
    assert.deepEqual(created, imported);
  });
  assert.deepEqual((({ width, height }) => ({ width, height }))(createSerialControlWidget("serial-log")), {
    width: 780,
    height: 348,
  });
  assert.notEqual(createSerialControlWidget("yt-chart").channels, createSerialControlWidget("yt-chart").channels);

  const simulationConfig = {
    preset: "imu6",
    sampleRateHz: 50,
    frequencyHz: 0.25,
    amplitude: 1,
    offset: 0,
    noise: 0,
    channelCount: 2,
    waveform: "sine",
    xyPattern: "circle",
  };
  const imuSample = createSimulationSample(simulationConfig, 0, () => 0.5);
  assert.deepEqual(Object.keys(imuSample), ["ax", "ay", "az", "gx", "gy", "gz"]);
  assert.ok(Object.values(imuSample).every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(imuSample.ax, imuSample.ay, imuSample.az) - 1) < 1e-6);
  assert.deepEqual(Object.keys(createSimulationSample({ ...simulationConfig, preset: "imu3" }, 0)), [
    "roll",
    "pitch",
    "yaw",
  ]);
  assert.deepEqual(normalizeSimulationConfig({ ...simulationConfig, sampleRateHz: 999, channelCount: 0 }), {
    ...simulationConfig,
    sampleRateHz: 200,
    channelCount: 1,
  });
  const filterDemoConfig = { ...simulationConfig, preset: "filter-demo", sampleRateHz: 10 };
  assert.deepEqual(createSimulationSample(filterDemoConfig, 0), { signal: 0 });
  assert.ok(Math.abs(createSimulationSample(filterDemoConfig, 0.05).signal - 1) < 1e-6);
  assert.equal(normalizeSimulationConfig(filterDemoConfig).sampleRateHz, 200);
  assert.deepEqual(resolveSimulationSampleRange(0, 200, 0), { startIndex: 0, endIndex: 1 });
  assert.deepEqual(resolveSimulationSampleRange(4.9, 200, 1), { startIndex: 1, endIndex: 1 });
  assert.deepEqual(resolveSimulationSampleRange(5, 200, 1), { startIndex: 1, endIndex: 2 });
  assert.deepEqual(resolveSimulationSampleRange(16, 200, 2), { startIndex: 2, endIndex: 4 });
  assert.deepEqual(resolveSimulationSampleRange(5000, 200, 0), { startIndex: 801, endIndex: 1001 });

  assert.equal(renderSerialControlCommand("PWM={value};COPY={value}", 128), "PWM=128;COPY=128");
  assert.equal(renderSerialJoystickCommand("X={x},Y={y}", -20, 30), "X=-20,Y=30");
  assert.deepEqual(parseSerialCommandSequence("\nAT\r\n\n AT+GMR "), ["AT", " AT+GMR "]);
  const chartData = [
    { timestamp: 1000, values: { x: 1, y: 10 } },
    { timestamp: 2000, values: { x: 2, y: 20 } },
    { timestamp: 3000, values: { x: 3, y: 30 } },
  ];
  assert.deepEqual(buildSerialControlChartData("xy", chartData, "x", ["y"], 2), [
    { __x: 2, y: 20 },
    { __x: 3, y: 30 },
  ]);
  assert.deepEqual(buildSerialControlChartData("yt", chartData, undefined, ["x", "y"], 2), [
    { __x: 0, x: 2, y: 20 },
    { __x: 1, x: 3, y: 30 },
  ]);
  assert.deepEqual(
    resolveSerialImuAngles(
      {
        rollChannel: "r",
        pitchChannel: "p",
        yawChannel: "y",
        angleUnit: "deg",
        rollOffset: 10,
        pitchOffset: 0,
        yawOffset: 0,
      },
      { r: 190, p: -20, y: 30 }
    ).display,
    { roll: -180, pitch: -20, yaw: 30 }
  );
  assert.equal(
    resolveSerialImuAngles(
      {
        rollChannel: "r",
        pitchChannel: "p",
        yawChannel: "y",
        angleUnit: "rad",
        rollOffset: 0,
        pitchOffset: 0,
        yawOffset: 0,
      },
      { r: Math.PI, p: 0, y: 0 }
    ).raw.roll,
    180
  );
  assert.equal(
    resolveSerialImuAngles(
      {
        rollChannel: "r",
        pitchChannel: "p",
        yawChannel: "y",
        angleUnit: "deg",
        rollOffset: 0,
        pitchOffset: 0,
        yawOffset: 0,
      },
      { r: 1, p: 2 }
    ),
    null
  );
  // 四元数直驱与叠加旋转：旧配置没有这些字段时按默认（关闭叠加）补齐
  const imuWidget = parseSerialControlPanel({ version: 4, widgets: [{ type: "imu-3d", sourceMode: "quat" }] })
    .widgets[0];
  assert.equal(imuWidget.sourceMode, "quat");
  assert.equal(imuWidget.overlayEnabled, false);
  assert.deepEqual(
    imuWidget.overlayQuat.map(({ value }) => value),
    [1, 0, 0, 0]
  );
  const yawOnly = resolveSerialImuPose(imuWidget, { qw: Math.SQRT1_2, qx: 0, qy: 0, qz: Math.SQRT1_2 }, null);
  assert.ok(Math.abs(yawOnly.raw.yaw - 90) < 1e-6);
  assert.deepEqual(resolveSerialImuPose(imuWidget, { qw: 1 }, null), { raw: null, missing: ["qx", "qy", "qz"] });
  const withMotor = {
    ...imuWidget,
    sourceMode: "euler",
    overlayEnabled: true,
    overlayEuler: [
      { source: "constant", channel: "", value: 0 },
      { source: "constant", channel: "", value: 0 },
      { source: "channel", channel: "motor", value: 0 },
    ],
  };
  const stacked = resolveSerialImuPose(withMotor, { roll: 0, pitch: 0, yaw: 20, motor: 30 }, null);
  assert.ok(Math.abs(stacked.raw.yaw - 50) < 1e-6, "同轴叠加角度相加");
  assert.deepEqual(resolveSerialImuPose(withMotor, { roll: 0, pitch: 0, yaw: 20 }, null).missing, ["motor"]);
  const fusionConfig = {
    accelXChannel: "ax",
    accelYChannel: "ay",
    accelZChannel: "az",
    gyroXChannel: "gx",
    gyroYChannel: "gy",
    gyroZChannel: "gz",
    gyroUnit: "dps",
    sampleRateHz: 100,
    filterAlpha: 1,
    gyroBiasX: 0,
    gyroBiasY: 0,
    gyroBiasZ: 0,
  };
  let fusion = updateImuFusion(
    createImuFusionState(),
    {
      timestamp: 0,
      values: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 },
    },
    fusionConfig
  );
  fusion = updateImuFusion(
    fusion,
    { timestamp: 10, values: { ax: 0, ay: 0, az: 1, gx: 90, gy: 0, gz: 45 } },
    fusionConfig
  );
  assert.ok(Math.abs(fusion.roll - 0.9) < 1e-9);
  assert.equal(fusion.pitch, 0);
  assert.ok(Math.abs(fusion.yaw - 0.45) < 1e-9);
  const imuPoints = [
    { timestamp: 0, values: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    { timestamp: 10, values: { ax: 0, ay: 0, az: 1, gx: 90, gy: 0, gz: 45 } },
  ];
  const imuProcessor = new ImuFusionProcessor();
  const firstOrientation = imuProcessor.process(imuPoints, fusionConfig);
  assert.ok(Math.abs(firstOrientation.roll - 0.9) < 1e-9);
  assert.ok(Math.abs(firstOrientation.yaw - 0.45) < 1e-9);
  assert.deepEqual(imuProcessor.process(imuPoints, fusionConfig), firstOrientation);
  assert.equal(imuProcessor.process(imuPoints, { ...fusionConfig, gyroBiasX: 90 }).roll, 0);
  assert.deepEqual(
    estimateGyroBias(
      [
        { timestamp: 0, values: { gx: 1, gy: 2, gz: 3 } },
        { timestamp: 1, values: { gx: 3, gy: 4, gz: 5 } },
      ],
      fusionConfig
    ),
    { x: 2, y: 3, z: 4 }
  );
  assert.deepEqual(joystickPointFromRatio({ xMin: -100, xMax: 100, yMin: -50, yMax: 50, step: 10 }, 0.76, 0.2), {
    x: 50,
    y: 30,
  });
  assert.deepEqual(parseHexBytes("48 65 6c 6C 6F"), [0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  assert.throws(() => parseHexBytes("0x12"), /十六进制/);

  const panel = parseSerialControlPanel({
    version: 3,
    name: "电机控制",
    widgets: [
      { id: "speed", type: "slider", label: "转速", min: 100, max: 10, step: 0, value: 999 },
      { id: "speed", type: "button", command: "STOP", format: "hex", columns: 12 },
      { id: "stick", type: "joystick", xMin: 10, xMax: 0, yMin: -5, yMax: -10, step: 0 },
      { id: "power", type: "gauge", channel: "battery", min: 100, max: 50, direction: "vertical" },
      { id: "temp", type: "value", channel: "temperature", unit: "℃" },
      { id: "trim", type: "stepper", min: 10, max: 0, step: 0, value: 999 },
      { id: "setup", type: "sequence", commands: "AT\nAT+GMR", intervalMs: 999999 },
      { id: "ready", type: "indicator", channel: "ready", threshold: "invalid" },
      { id: "xy", type: "xy-chart", xChannel: "x", yChannel: "y", pointLimit: 99999 },
      {
        id: "yt",
        type: "yt-chart",
        channels: ["temp", "speed"],
        pointLimit: -1,
        interpolation: "smooth",
        rows: 99,
      },
      {
        id: "imu",
        type: "imu-3d",
        sourceMode: "imu6",
        angleUnit: "rad",
        sampleRateHz: 0,
        filterAlpha: 9,
        rollOffset: "invalid",
      },
      { id: "fft", type: "fft-chart", channels: ["temp", "speed"], pointLimit: 99999, columns: 12 },
      { id: "rx-log", type: "serial-log", direction: "rx", columns: 8, rows: 5 },
      { type: "unknown" },
    ],
  });

  assert.equal(panel.widgets.length, 13);
  assert.deepEqual(
    panel.widgets.map(({ id, type }) => [id, type]),
    [
      ["speed", "slider"],
      ["speed-2", "button"],
      ["stick", "joystick"],
      ["power", "gauge"],
      ["temp", "value"],
      ["trim", "stepper"],
      ["setup", "sequence"],
      ["ready", "indicator"],
      ["xy", "xy-chart"],
      ["yt", "yt-chart"],
      ["imu", "imu-3d"],
      ["fft", "fft-chart"],
      ["rx-log", "serial-log"],
    ]
  );
  assert.equal(panel.version, 4);
  assert.equal(panel.widgets[1].width, 1200);
  assert.deepEqual({ left: panel.widgets[1].left, top: panel.widgets[1].top }, { left: 0, top: 180 });
  assert.throws(() => parseSerialControlPanel({ version: 1, widgets: [] }), /不支持/);
  assert.deepEqual(
    {
      min: panel.widgets[0].min,
      max: panel.widgets[0].max,
      step: panel.widgets[0].step,
      value: panel.widgets[0].value,
    },
    { min: 100, max: 101, step: 1, value: 101 }
  );
  assert.deepEqual(
    {
      xMin: panel.widgets[2].xMin,
      xMax: panel.widgets[2].xMax,
      yMin: panel.widgets[2].yMin,
      yMax: panel.widgets[2].yMax,
      step: panel.widgets[2].step,
      x: panel.widgets[2].x,
      left: panel.widgets[2].left,
    },
    { xMin: 10, xMax: 11, yMin: -5, yMax: -4, step: 1, x: 10.5, left: 0 }
  );
  assert.equal(panel.widgets[3].max, 101);
  assert.deepEqual(
    {
      min: panel.widgets[5].min,
      max: panel.widgets[5].max,
      step: panel.widgets[5].step,
      value: panel.widgets[5].value,
    },
    { min: 10, max: 11, step: 1, value: 11 }
  );
  assert.equal(panel.widgets[6].intervalMs, 60000);
  assert.equal(panel.widgets[7].threshold, 0.5);
  assert.equal(panel.widgets[8].pointLimit, 2000);
  assert.equal(panel.widgets[9].pointLimit, 10);
  assert.deepEqual(panel.widgets[9].channels, ["temp", "speed"]);
  assert.equal(panel.widgets[9].height, 708);
  assert.equal(panel.widgets[9].interpolation, "smooth");
  assert.equal(panel.widgets[11].pointLimit, 2000);
  assert.equal(panel.widgets[12].direction, "rx");
  assert.deepEqual(
    {
      rollChannel: panel.widgets[10].rollChannel,
      pitchChannel: panel.widgets[10].pitchChannel,
      yawChannel: panel.widgets[10].yawChannel,
      sourceMode: panel.widgets[10].sourceMode,
      angleUnit: panel.widgets[10].angleUnit,
      sampleRateHz: panel.widgets[10].sampleRateHz,
      filterAlpha: panel.widgets[10].filterAlpha,
      rollOffset: panel.widgets[10].rollOffset,
    },
    {
      rollChannel: "roll",
      pitchChannel: "pitch",
      yawChannel: "yaw",
      sourceMode: "imu6",
      angleUnit: "rad",
      sampleRateHz: 1,
      filterAlpha: 1,
      rollOffset: 0,
    }
  );
  assert.deepEqual(parseSerialControlPanel({ version: 3, widgets: [] }), {
    version: 4,
    name: "默认控制面板",
    widgets: [],
  });
  const freeLayout = parseSerialControlPanel({
    version: 4,
    widgets: [{ id: "free", type: "button", left: 123.5, top: 45.25, width: 456.75, height: 222.5 }],
  });
  assert.deepEqual((({ left, top, width, height }) => ({ left, top, width, height }))(freeLayout.widgets[0]), {
    left: 123.5,
    top: 45.25,
    width: 456.75,
    height: 222.5,
  });
  assert.throws(() => parseSerialControlPanel({ version: 3, widgets: [{ type: "unknown" }] }), /没有可用/);

  console.log("串口控制面板配置检查通过");
} finally {
  await server.close();
}
