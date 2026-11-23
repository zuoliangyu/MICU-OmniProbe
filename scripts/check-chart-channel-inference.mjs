import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });

try {
  const {
    detectChartConfig,
    haveChannelKeysChanged,
    populateEmptyChannelsFromSamples,
    previewChartParser,
    resolveAppliedParserChannels,
  } = await server.ssrLoadModule("/src/lib/chartAnalysis.ts");
  const {
    decodeDelimiter,
    encodeDelimiter,
    listChartParsers,
    parseChartData,
    parseChartLines,
    parseWithDelimiter,
    parseWithKv,
    registerChartParser,
  } = await server.ssrLoadModule("/src/lib/parseChartData.ts");
  const { ChartIngestionBuffer, appendChartData } = await server.ssrLoadModule("/src/lib/chartIngestion.ts");
  const { parseRttData, parseSerialData, TextFrameStream } = await server.ssrLoadModule("/src/lib/dataFraming.ts");
  const { DEFAULT_CHART_CONFIG, getSignalWorkspaceTransition, isSignalWorkspaceActive, migrateChartConfig } =
    await server.ssrLoadModule("/src/lib/chartTypes.ts");
  const {
    applyDataFilter,
    calculateSosFrequencyResponse,
    designParametricSos,
    parseMatlabSos,
    parseMatlabVector,
    resolveChartProcessing,
  } = await server.ssrLoadModule("/src/lib/chartFilter.ts");
  const { appendTelemetryProcessing, appendTelemetrySamples, resolveTelemetryProcessing } =
    await server.ssrLoadModule("/src/lib/telemetry.ts");
  const { traceSignalPath } = await server.ssrLoadModule("/src/components/rtt/SignalPlotCanvas.tsx");
  const { resolveChartDisplayData } = await server.ssrLoadModule("/src/components/rtt/ChartViewer.tsx");

  assert.equal(DEFAULT_CHART_CONFIG.waveformInterpolation, "linear");
  assert.equal(migrateChartConfig({ waveformInterpolation: "smooth" }).waveformInterpolation, "smooth");
  assert.equal(migrateChartConfig({ waveformInterpolation: "invalid" }).waveformInterpolation, "linear");
  assert.equal(migrateChartConfig({}).framePrefix, "");
  assert.equal(migrateChartConfig({ framePrefix: "P:" }).framePrefix, "P:");
  assert.equal(migrateChartConfig({ parseMode: "justfloat" }).parseMode, "justfloat");
  assert.equal(migrateChartConfig({ parseMode: "justfloat" }, false).parseMode, "auto");
  assert.deepEqual(parseMatlabVector("b = [0.25 0.5 0.25]"), [0.25, 0.5, 0.25]);
  assert.deepEqual(parseMatlabSos("1 0 0 1 0 0;\n1 2 1 1 -1.5 0.7"), [
    [1, 0, 0, 1, 0, 0],
    [1, 2, 1, 1, -1.5, 0.7],
  ]);
  assert.equal(parseMatlabSos("1 2 3"), null);

  const livePoints = [{ timestamp: 1, values: { ch1: 1 } }];
  const newerPoints = [...livePoints, { timestamp: 2, values: { ch1: 2 } }];
  assert.equal(resolveChartDisplayData(newerPoints, true, livePoints).displayedData, livePoints);
  assert.equal(resolveChartDisplayData(newerPoints, false, livePoints).displayedData, newerPoints);
  assert.deepEqual(resolveChartDisplayData([], true, livePoints).displayedData, []);

  const samples = [2, 4, 6].map((value, index) => ({ timestamp: index, values: { ch1: value } }));
  const firResult = applyDataFilter(samples, ["ch1"], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "fir",
    firCoefficients: [0.5, 0.5],
  });
  assert.deepEqual(
    firResult.map((point) => point.values.ch1),
    [1, 3, 5]
  );
  assert.deepEqual(
    samples.map((point) => point.values.ch1),
    [2, 4, 6]
  );
  const processing = resolveChartProcessing(samples, ["ch1"], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "fir",
    firCoefficients: [0.5, 0.5],
    showOriginal: true,
  });
  assert.equal(processing.filterActive, true);
  assert.equal(processing.comparisonData, samples);
  assert.deepEqual(
    processing.processedData.map((point) => point.values.ch1),
    [1, 3, 5]
  );
  assert.equal(resolveChartProcessing(samples, ["ch1"], DEFAULT_CHART_CONFIG.dataFilter).processedData, samples);

  const telemetryRaw = appendTelemetrySamples(samples.slice(0, 1), samples.slice(1), 2);
  assert.deepEqual(
    telemetryRaw.map((point) => point.values.ch1),
    [4, 6]
  );
  const telemetryProcessing = resolveTelemetryProcessing(telemetryRaw, [{ key: "ch1", name: "通道 1" }], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "fir",
    firCoefficients: [0.5, 0.5],
  });
  assert.equal(telemetryProcessing.rawData, telemetryRaw);
  assert.deepEqual(
    telemetryProcessing.processedData.map((point) => point.values.ch1),
    [2, 5]
  );
  assert.deepEqual(
    telemetryRaw.map((point) => point.values.ch1),
    [4, 6]
  );
  assert.equal(
    resolveTelemetryProcessing(telemetryRaw, [{ key: "ch1", name: "通道 1" }], DEFAULT_CHART_CONFIG.dataFilter)
      .processedData,
    telemetryRaw
  );
  const appendedProcessing = appendTelemetryProcessing(
    samples.slice(0, 1),
    samples.slice(1),
    2,
    [{ key: "ch1", name: "通道 1" }],
    {
      ...DEFAULT_CHART_CONFIG.dataFilter,
      enabled: true,
      kind: "fir",
      firCoefficients: [0.5, 0.5],
    }
  );
  assert.deepEqual(
    appendedProcessing.rawData.map((point) => point.values.ch1),
    [4, 6]
  );
  assert.deepEqual(
    appendedProcessing.processedData.map((point) => point.values.ch1),
    [2, 5]
  );
  assert.equal(appendedProcessing.filterActive, true);

  const sosResult = applyDataFilter(samples, ["ch1"], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "sos",
    sosSections: [[1, 0, 0, 1, 0, 0]],
    scaleValues: [2],
  });
  assert.deepEqual(
    sosResult.map((point) => point.values.ch1),
    [4, 8, 12]
  );
  const recursiveResult = applyDataFilter(
    [1, 0, 0].map((value, index) => ({ timestamp: index, values: { ch1: value } })),
    ["ch1"],
    {
      ...DEFAULT_CHART_CONFIG.dataFilter,
      enabled: true,
      kind: "sos",
      sosSections: [[1, 0, 0, 1, -0.5, 0]],
    }
  );
  assert.deepEqual(
    recursiveResult.map((point) => point.values.ch1),
    [1, 0.5, 0.25]
  );
  const medianResult = applyDataFilter(samples, ["ch1"], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "median",
    medianWindowSize: 3,
  });
  assert.equal(medianResult.at(-1).values.ch1, 4);

  const parametricStages = [
    { id: "low", type: "lowpass", enabled: true, frequencyHz: 20, q: Math.SQRT1_2 },
    { id: "high", type: "highpass", enabled: true, frequencyHz: 2, q: Math.SQRT1_2 },
    { id: "band", type: "bandpass", enabled: true, frequencyHz: 10, q: 2 },
  ];
  const migratedCascade = migrateChartConfig({
    dataFilter: { enabled: true, kind: "cascade", sampleRateHz: 1000, parametricStages },
  }).dataFilter;
  assert.equal(migratedCascade.kind, "cascade");
  assert.equal(migratedCascade.parametricStages.length, 3);
  const designedSos = designParametricSos(parametricStages, 1000);
  assert.equal(designedSos.length, 3);
  const responseAtDc = ([b0, b1, b2, a0, a1, a2]) => (b0 + b1 + b2) / (a0 + a1 + a2);
  const responseAtNyquist = ([b0, b1, b2, a0, a1, a2]) => (b0 - b1 + b2) / (a0 - a1 + a2);
  assert.ok(Math.abs(responseAtDc(designedSos[0]) - 1) < 1e-9);
  assert.ok(Math.abs(responseAtDc(designedSos[1])) < 1e-9);
  assert.ok(Math.abs(responseAtDc(designedSos[2])) < 1e-9);
  assert.ok(Math.abs(responseAtNyquist(designedSos[0])) < 1e-9);
  assert.ok(Math.abs(responseAtNyquist(designedSos[1]) - 1) < 1e-9);
  assert.ok(Math.abs(responseAtNyquist(designedSos[2])) < 1e-9);
  assert.ok(designedSos[2][0] > 0 && designedSos[2][2] === -designedSos[2][0]);
  assert.equal(designParametricSos(parametricStages, 0), null);
  assert.equal(designParametricSos([{ ...parametricStages[0], frequencyHz: 500 }], 1000), null);
  assert.equal(designParametricSos([{ ...parametricStages[0], enabled: false }], 1000).length, 0);
  const response = calculateSosFrequencyResponse(designedSos.slice(0, 1), 1000, 3);
  assert.equal(response.length, 3);
  assert.ok(response[0].magnitudeDb > response[2].magnitudeDb);

  const cascadeResult = applyDataFilter(samples, ["ch1"], {
    ...DEFAULT_CHART_CONFIG.dataFilter,
    enabled: true,
    kind: "cascade",
    sampleRateHz: 1000,
    parametricStages: parametricStages.slice(0, 2),
  });
  assert.equal(cascadeResult.length, samples.length);
  assert.ok(cascadeResult.every((point) => Number.isFinite(point.values.ch1)));

  const pathCalls = [];
  const pathContext = {
    moveTo: (...args) => pathCalls.push(["moveTo", ...args]),
    lineTo: (...args) => pathCalls.push(["lineTo", ...args]),
    bezierCurveTo: (...args) => pathCalls.push(["bezierCurveTo", ...args]),
  };
  const points = [
    { x: 0, y: 5 },
    { x: 10, y: 0 },
    { x: 20, y: 10 },
  ];
  traceSignalPath(pathContext, points, "linear");
  assert.deepEqual(
    pathCalls.map(([command]) => command),
    ["moveTo", "lineTo", "lineTo"]
  );
  pathCalls.length = 0;
  traceSignalPath(pathContext, points, "smooth");
  assert.deepEqual(
    pathCalls.map(([command]) => command),
    ["moveTo", "bezierCurveTo", "bezierCurveTo"]
  );
  assert.deepEqual(pathCalls.at(-1).slice(-2), [20, 10]);

  const auto = populateEmptyChannelsFromSamples(DEFAULT_CHART_CONFIG, [{ text: "1,2" }, { text: "3,4" }]);
  assert.equal(auto.parseMode, "delimiter");
  assert.equal(auto.channels.length, 2);

  const analyzed = detectChartConfig(DEFAULT_CHART_CONFIG, [{ text: "1,2" }, { text: "3,4" }]);
  assert.ok(analyzed.detection.confidence >= 0.5);
  assert.equal(analyzed.config.parseMode, "delimiter");
  assert.equal(analyzed.config.channels.length, 2);
  assert.equal(detectChartConfig(DEFAULT_CHART_CONFIG, [{ text: "not chart data" }]).config, DEFAULT_CHART_CONFIG);

  assert.deepEqual(parseWithKv("mid:0,power:86,cam:0x8").dataPoint.values, { mid: 0, power: 86, cam: 8 });
  const colonKv = populateEmptyChannelsFromSamples({ ...DEFAULT_CHART_CONFIG, framePrefix: "D:" }, [
    { text: "D:mid:0,water:0,power:80,dtgt:0,soft:0" },
    { text: "D:mid:0,water:1,power:86,dtgt:2,soft:3" },
  ]);
  assert.equal(colonKv.parseMode, "kv");
  assert.deepEqual(
    colonKv.channels.map((channel) => channel.key),
    ["mid", "water", "power", "dtgt", "soft"]
  );

  const regexPreview = previewChartParser(
    {
      ...DEFAULT_CHART_CONFIG,
      parseMode: "regex",
      framePrefix: "D:",
      regexPattern:
        "mid:(?<mid>-?\\d+),water:(?<water>-?\\d+),power:(?<power>-?\\d+),dtgt:(?<dtgt>-?\\d+),soft:(?<soft>-?\\d+)",
    },
    [{ text: "D:mid:0,water:1,power:86,dtgt:2,soft:3" }],
    "D:mid:0,water:1,power:86,dtgt:2,soft:3"
  );
  assert.equal(regexPreview.success, true);
  assert.deepEqual(regexPreview.values, { mid: 0, water: 1, power: 86, dtgt: 2, soft: 3 });
  assert.equal(previewChartParser({ ...DEFAULT_CHART_CONFIG, parseMode: "regex" }, [], "not matched").success, false);

  const json = populateEmptyChannelsFromSamples({ ...DEFAULT_CHART_CONFIG, parseMode: "json" }, [
    { text: '{"temp":25.1,"humi":48}' },
  ]);
  assert.deepEqual(
    json.channels.map((channel) => channel.key),
    ["temp", "humi"]
  );

  const detectedJsonChannels = previewChartParser(
    { ...DEFAULT_CHART_CONFIG, parseMode: "auto", channels: [] },
    [],
    '{"ch1":0.707107,"ch2":0.707107}'
  ).config.channels;
  const appliedJsonChannels = resolveAppliedParserChannels(
    [{ key: "signal", name: "signal", color: "#3b82f6", visible: true, unit: "", role: "y" }],
    detectedJsonChannels
  );
  assert.deepEqual(
    appliedJsonChannels.map((channel) => channel.key),
    ["ch1", "ch2"]
  );
  assert.equal(haveChannelKeysChanged([{ key: "signal" }], appliedJsonChannels), true);

  const styledJsonChannels = resolveAppliedParserChannels(
    [{ key: "ch1", name: "电压", color: "#f97316", visible: false, unit: "V", role: "y" }],
    detectedJsonChannels
  );
  assert.deepEqual(
    {
      name: styledJsonChannels[0].name,
      color: styledJsonChannels[0].color,
      visible: styledJsonChannels[0].visible,
      unit: styledJsonChannels[0].unit,
    },
    { name: "电压", color: "#f97316", visible: false, unit: "V" }
  );

  const delimiter = populateEmptyChannelsFromSamples(
    { ...DEFAULT_CHART_CONFIG, parseMode: "delimiter", delimiter: "," },
    [{ text: "ok,10,20" }, { text: "ok,11,21" }]
  );
  assert.deepEqual(
    delimiter.channels.map(({ key, sourceIndex }) => [key, sourceIndex]),
    [
      ["field2", 1],
      ["field3", 2],
    ]
  );

  const prefixed = populateEmptyChannelsFromSamples(
    { ...DEFAULT_CHART_CONFIG, parseMode: "delimiter", framePrefix: "P:", delimiter: "," },
    [{ text: "INFO boot 123" }, { text: "P:10,20" }, { text: "P:11,21" }]
  );
  assert.deepEqual(
    prefixed.channels.map(({ key, sourceIndex }) => [key, sourceIndex]),
    [
      ["field1", 0],
      ["field2", 1],
    ]
  );

  const prefixedConfig = {
    ...DEFAULT_CHART_CONFIG,
    enabled: true,
    parseMode: "delimiter",
    framePrefix: "P:",
    delimiter: ",",
    channels: [prefixed.channels[0]],
  };
  assert.equal(parseChartData("INFO boot 123", prefixedConfig).ignored, true);
  assert.equal(parseChartData("P:42,7", prefixedConfig).dataPoint.values.field1, 42);
  assert.equal(parseWithDelimiter("42Hz", ",", prefixedConfig.channels).success, false);

  // ---- 分隔符转义：输入框写 \t 等转义序列，串口、RTT、BLE 共用同一条解析路径 ----
  {
    const columns = [
      { key: "a", sourceIndex: 0 },
      { key: "b", sourceIndex: 1 },
    ];
    assert.equal(decodeDelimiter("\\t"), "\t");
    assert.equal(decodeDelimiter("\\r\\n"), "\r\n");
    assert.equal(decodeDelimiter("\\\\"), "\\");
    assert.equal(decodeDelimiter("\\x1F"), "\x1f");
    assert.equal(decodeDelimiter("\t"), "\t", "已经是实际字符时原样返回");
    assert.equal(decodeDelimiter("\\q"), "\\q", "无法识别的转义保留字面");
    assert.equal(decodeDelimiter(encodeDelimiter("\t;\\")), "\t;\\", "编码后再解码应还原");

    assert.deepEqual(parseWithDelimiter("1.5\t2.5", "\\t", columns).dataPoint.values, { a: 1.5, b: 2.5 });
    assert.deepEqual(parseWithDelimiter("3\\4", "\\\\", columns).dataPoint.values, { a: 3, b: 4 });
    assert.deepEqual(parseWithDelimiter("5\x1f6", "\\x1f", columns).dataPoint.values, { a: 5, b: 6 });
    assert.equal(parseWithDelimiter("1,2", "", columns).success, false, "空分隔符不应把每个字符拆成一列");

    // 走完整的 parseChartData（RTT / BLE / 串口文本行的共同入口）
    const tabConfig = {
      ...DEFAULT_CHART_CONFIG,
      enabled: true,
      parseMode: "delimiter",
      delimiter: "\\t",
      channels: columns,
    };
    assert.deepEqual(parseChartData("7\t8", tabConfig).dataPoint.values, { a: 7, b: 8 });

    // 打开配置窗口时按转义分隔符预建通道
    const tabChannels = populateEmptyChannelsFromSamples(
      { ...DEFAULT_CHART_CONFIG, parseMode: "delimiter", delimiter: "\\t" },
      [{ text: "1\t2" }, { text: "3\t4" }]
    );
    assert.deepEqual(
      tabChannels.channels.map(({ sourceIndex }) => sourceIndex),
      [0, 1]
    );

    // 智能识别出制表符时写成可见的 \t，并且能直接用于解析
    const detectedTab = detectChartConfig(DEFAULT_CHART_CONFIG, [
      { text: "1.5\t2.5\t3.5" },
      { text: "4.5\t5.5\t6.5" },
      { text: "7.5\t8.5\t9.5" },
    ]);
    assert.equal(detectedTab.config.parseMode, "delimiter");
    assert.equal(detectedTab.config.delimiter, "\\t");
    assert.equal(parseChartData("1.5\t2.5\t3.5", detectedTab.config).success, true);
  }

  const sourceTimestamp = 1_721_814_274_123;
  const parsedBatch = parseChartLines([{ text: "P:42,7", timestamp: new Date(sourceTimestamp) }], prefixedConfig);
  assert.equal(parsedBatch.points[0].timestamp, sourceTimestamp);
  assert.deepEqual({ success: parsedBatch.success, fail: parsedBatch.fail }, { success: 1, fail: 0 });

  const ingestion = new ChartIngestionBuffer(2);
  ingestion.ingestLines(
    [
      { text: "P:1,0", timestamp: 1 },
      { text: "invalid", timestamp: 2 },
      { text: "P:bad,0", timestamp: 2 },
      { text: "P:3,0", timestamp: 3 },
      { text: "P:4,0", timestamp: 4 },
    ],
    prefixedConfig
  );
  assert.deepEqual(ingestion.drain(), {
    points: [
      { timestamp: 3, values: { field1: 3 } },
      { timestamp: 4, values: { field1: 4 } },
    ],
    success: 3,
    fail: 1,
  });
  assert.deepEqual(ingestion.drain(), { points: [], success: 0, fail: 0 });
  assert.deepEqual(appendChartData([{ timestamp: 1, values: {} }], [{ timestamp: 2, values: {} }], 1), [
    { timestamp: 2, values: {} },
  ]);

  const encodedLine = Array.from(new TextEncoder().encode("温度=25\r\n"));
  const firstChunk = parseSerialData(encodedLine.slice(0, 2), sourceTimestamp, "rx", { text: "", rawData: [] });
  assert.equal(firstChunk.lines.length, 0);
  const secondChunk = parseSerialData(encodedLine.slice(2), sourceTimestamp, "rx", firstChunk.pending);
  assert.equal(secondChunk.lines[0].text, "温度=25");
  assert.equal(secondChunk.lines[0].timestamp.getTime(), sourceTimestamp);

  const rttPending = new Map();
  assert.equal(parseRttData(encodedLine.slice(0, 2), 1, sourceTimestamp, rttPending).length, 0);
  const rttLines = parseRttData(encodedLine.slice(2), 1, sourceTimestamp, rttPending);
  assert.deepEqual(
    { channel: rttLines[0].channel, text: rttLines[0].text, timestamp: rttLines[0].timestamp.getTime() },
    { channel: 1, text: "温度=25", timestamp: sourceTimestamp }
  );

  const frameStream = new TextFrameStream();
  assert.equal(frameStream.ingest(Array.from(new TextEncoder().encode("残帧")), sourceTimestamp, "rx").length, 0);
  assert.equal(frameStream.flush(sourceTimestamp + 200)[0].text, "残帧");
  frameStream.ingest([0x31], sourceTimestamp, "rx");
  frameStream.reset();
  assert.equal(frameStream.flush().length, 0);

  const plugin = {
    id: "plugin:double",
    label: "双倍数值",
    parse: (text, _config, timestamp) => ({
      success: true,
      method: "plugin:double",
      dataPoint: { timestamp, values: { doubled: Number(text) * 2 } },
    }),
  };
  const unregisterPlugin = registerChartParser(plugin);
  assert.equal(
    listChartParsers().some(({ id }) => id === plugin.id),
    true
  );
  const pluginConfig = migrateChartConfig({ ...prefixedConfig, framePrefix: "", parseMode: plugin.id });
  assert.equal(pluginConfig.parseMode, plugin.id);
  assert.deepEqual(parseChartData("21", pluginConfig, sourceTimestamp).dataPoint, {
    timestamp: sourceTimestamp,
    values: { doubled: 42 },
  });
  assert.throws(() => registerChartParser(plugin), /已注册/);
  assert.throws(() => registerChartParser({ ...plugin, id: "invalid" }), /plugin:/);
  assert.equal(migrateChartConfig({ parseMode: "plugin:../invalid" }).parseMode, "auto");
  unregisterPlugin();
  assert.match(parseChartData("21", pluginConfig, sourceTimestamp).error, /未注册/);

  const configured = { ...DEFAULT_CHART_CONFIG, channels: [delimiter.channels[0]] };
  assert.equal(populateEmptyChannelsFromSamples(configured, [{ text: "1,2,3" }]), configured);

  const opened = getSignalWorkspaceTransition("text", DEFAULT_CHART_CONFIG, "time");
  assert.equal(opened.viewMode, "split");
  assert.equal(isSignalWorkspaceActive(opened.viewMode, opened.chartConfig, "time"), true);

  const switched = getSignalWorkspaceTransition(opened.viewMode, opened.chartConfig, "fft");
  assert.equal(switched.viewMode, "split");
  assert.equal(isSignalWorkspaceActive(switched.viewMode, switched.chartConfig, "fft"), true);

  const closed = getSignalWorkspaceTransition(switched.viewMode, switched.chartConfig, "fft");
  assert.equal(closed.viewMode, "text");
  assert.equal(closed.chartConfig, switched.chartConfig);

  console.log("图表缓冲区通道推导检查通过");
} finally {
  await server.close();
}
