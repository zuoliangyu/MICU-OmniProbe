// 触发捕获接入 store 后的端到端验证。
//
// 核心状态机已单独测过，这里验的是「接线对不对」：配置能否读到、
// 捕获完成后图表是否真的冻结、两种视图模式取到的数据是否符合预期、
// 重新武装与清空是否把状态收拾干净。
//
// 三条来源各自持有独立的检测器实例，因此逐个验证，避免只有串口接对了。
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });

try {
  const { DEFAULT_CHART_CONFIG, DEFAULT_TRIGGER_CONFIG, migrateChartConfig } =
    await server.ssrLoadModule("/src/lib/chartTypes.ts");
  const { useSerialStore } = await server.ssrLoadModule("/src/stores/serialStore.ts");
  const { useRttStore } = await server.ssrLoadModule("/src/stores/rttStore.ts");
  const { useBluetoothStore } = await server.ssrLoadModule("/src/stores/bluetoothStore.ts");

  const STORES = [
    ["serial", useSerialStore],
    ["rtt", useRttStore],
    ["bluetooth", useBluetoothStore],
  ];

  const point = (v, t) => ({ timestamp: t, values: { v } });

  /** 造一个带触发配置的图表配置 */
  const chartConfigWith = (trigger) => ({
    ...DEFAULT_CHART_CONFIG,
    enabled: true,
    channels: [{ key: "v", name: "V", color: "#111", visible: true, role: "y" }],
    trigger: { ...DEFAULT_TRIGGER_CONFIG, enabled: true, channelKey: "v", ...trigger },
  });

  const resetStore = (store, chartConfig) => {
    store.setState({
      chartData: [],
      processedChartData: [],
      filterActive: false,
      chartPaused: false,
      triggeredAt: null,
      triggerCapture: null,
      parseSuccessCount: 0,
      parseFailCount: 0,
      chartConfig,
    });
    store.getState().clearChartData();
    store.setState({ chartConfig });
  };

  // ---- 1) 三条来源都有触发相关状态与动作 ----
  {
    for (const [name, store] of STORES) {
      const state = store.getState();
      assert.equal(state.triggeredAt, null, `${name} 初始 triggeredAt 应为 null`);
      assert.equal(typeof state.rearmTrigger, "function", `${name} 应有 rearmTrigger`);
      assert.ok(state.chartConfig.trigger, `${name} 的 chartConfig 应含 trigger 配置`);
    }
    console.log("  三条来源均已接入触发状态与重新武装动作");
  }

  // ---- 2) 未启用触发时不应冻结图表 ----
  {
    for (const [name, store] of STORES) {
      const config = { ...chartConfigWith({}), trigger: { ...DEFAULT_TRIGGER_CONFIG, enabled: false } };
      resetStore(store, config);
      store.getState().addChartDataBatch([point(0, 0), point(100, 1), point(0, 2)]);
      assert.equal(store.getState().chartPaused, false, `${name}：未启用触发时不应冻结`);
      assert.equal(store.getState().triggeredAt, null);
    }
    console.log("  未启用触发时数据照常滚动，不冻结");
  }

  // ---- 3) 窗口模式：触发后冻结，图表只保留触发窗口 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({
        condition: "rising",
        level: 50,
        preSamples: 5,
        postSamples: 3,
        mode: "single",
        view: "window",
      });
      resetStore(store, config);

      // 先灌一批低于电平的样本作为预触发数据
      const pre = Array.from({ length: 20 }, (_, i) => point(0, i));
      store.getState().addChartDataBatch(pre);
      assert.equal(store.getState().chartPaused, false, `${name}：未穿越时不应冻结`);

      // 穿越 + 足够的后置样本
      store.getState().addChartDataBatch([point(100, 20), point(100, 21), point(100, 22)]);

      const after = store.getState();
      assert.equal(after.chartPaused, true, `${name}：触发后应冻结图表`);
      assert.equal(after.triggeredAt, 20, `${name}：触发点时间戳应为穿越那一刻`);
      const captured = after.triggerCapture?.chartData ?? [];
      assert.equal(captured.length, 8, `${name}：捕获画面应为 pre + post = 8 个点，实际 ${captured.length}`);
      assert.equal(captured[captured.length - 1].timestamp, 22, `${name}：窗口末尾应是最后一个后置样本`);
      assert.equal(after.chartData.length, 23, `${name}：滚动缓冲区不应被裁成窗口，恢复跟随后历史仍在`);
    }
    console.log("  窗口模式：触发后冻结，捕获画面只保留 pre + post 个点，滚动缓冲区保持完整");
  }

  // ---- 4) 全量模式：触发后冻结，但保留整个缓冲区 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({
        condition: "rising",
        level: 50,
        preSamples: 5,
        postSamples: 3,
        mode: "single",
        view: "full",
      });
      resetStore(store, config);

      const pre = Array.from({ length: 20 }, (_, i) => point(0, i));
      store.getState().addChartDataBatch(pre);
      store.getState().addChartDataBatch([point(100, 20), point(100, 21), point(100, 22)]);

      const after = store.getState();
      assert.equal(after.chartPaused, true, `${name}：全量模式同样应冻结`);
      assert.equal(
        after.triggerCapture?.chartData.length,
        23,
        `${name}：全量模式的捕获画面应保留整个缓冲区，实际 ${after.triggerCapture?.chartData.length}`
      );
      assert.equal(after.triggeredAt, 20, `${name}：全量模式也要给出触发点供标记`);
    }
    console.log("  全量模式：触发后冻结但保留完整缓冲区，仅记录触发点");
  }

  // ---- 5) 重新武装应解冻并清除触发点 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({ condition: "above", level: 50, postSamples: 1, mode: "single" });
      resetStore(store, config);
      store.getState().addChartDataBatch([point(100, 0)]);
      assert.equal(store.getState().chartPaused, true, `${name}：应已触发`);

      store.getState().rearmTrigger();
      assert.equal(store.getState().chartPaused, false, `${name}：重新武装应解冻`);
      assert.equal(store.getState().triggeredAt, null, `${name}：重新武装应清除触发点`);
      assert.equal(store.getState().triggerCapture, null, `${name}：重新武装应丢弃捕获画面`);

      // 重新武装后应能再次触发
      store.getState().addChartDataBatch([point(100, 10)]);
      assert.equal(store.getState().chartPaused, true, `${name}：重新武装后应能再次触发`);
    }
    console.log("  重新武装：解冻、清除触发点，且能再次触发");
  }

  // ---- 6) 清空图表应把触发状态一并收拾干净 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({ condition: "above", level: 50, postSamples: 1, mode: "single" });
      resetStore(store, config);
      store.getState().addChartDataBatch([point(100, 0)]);
      assert.equal(store.getState().triggeredAt, 0);

      store.getState().clearChartData();
      assert.equal(store.getState().triggeredAt, null, `${name}：清空应清除触发点`);
      assert.equal(store.getState().triggerCapture, null, `${name}：清空应丢弃捕获画面`);
      assert.deepEqual(store.getState().chartData, [], `${name}：清空应清空数据`);

      // 清空后检测器也应复位——否则残留的"已触发"状态会让后续数据永远不再触发
      store.setState({ chartPaused: false });
      store.getState().addChartDataBatch([point(100, 10)]);
      assert.equal(store.getState().chartPaused, true, `${name}：清空后应能重新触发（检测器已复位）`);
    }
    console.log("  清空图表：触发点与检测器状态一并复位");
  }

  // ---- 7) 触发配置要能从持久化结构里恢复并被收敛 ----
  {
    const restored = migrateChartConfig({
      ...DEFAULT_CHART_CONFIG,
      trigger: { enabled: true, channelKey: "x", condition: "falling", level: 3.5, preSamples: 10, postSamples: 20 },
    });
    assert.equal(restored.trigger.enabled, true);
    assert.equal(restored.trigger.condition, "falling");
    assert.equal(restored.trigger.level, 3.5);
    assert.equal(restored.trigger.mode, DEFAULT_TRIGGER_CONFIG.mode, "缺失字段应回落到默认值");

    // 非法值应被收敛而不是让状态机跑飞
    const sanitized = migrateChartConfig({
      ...DEFAULT_CHART_CONFIG,
      trigger: { enabled: true, condition: "不存在", mode: "??", view: "??", preSamples: 0, postSamples: -5 },
    });
    assert.equal(sanitized.trigger.condition, DEFAULT_TRIGGER_CONFIG.condition, "非法条件应回落默认");
    assert.equal(sanitized.trigger.mode, DEFAULT_TRIGGER_CONFIG.mode, "非法模式应回落默认");
    assert.equal(sanitized.trigger.view, DEFAULT_TRIGGER_CONFIG.view, "非法视图应回落默认");
    assert.ok(sanitized.trigger.preSamples >= 1, "前置样本数至少为 1，否则窗口为空");
    assert.ok(sanitized.trigger.postSamples >= 1, "后置样本数至少为 1");
    console.log("  触发配置可从持久化恢复，非法值被收敛到合法范围");
  }

  // ---- 8) 开启滤波时：两个缓冲区必须按同一窗口裁剪，且触发依据是滤波后的值 ----
  //
  // 图表在滤波开启时显示的是 processedChartData。若只裁 chartData，
  // 窗口模式对开了滤波的用户就完全不生效——而这正是初版的实际行为。
  {
    for (const [name, store] of STORES) {
      const base = chartConfigWith({
        condition: "rising",
        level: 50,
        preSamples: 5,
        postSamples: 3,
        mode: "single",
        view: "window",
      });
      // 均值滤波：两点平均，会让阶跃的到达时刻推迟，正好用来区分「按原始值判断」和「按显示值判断」
      const config = {
        ...base,
        dataFilter: { ...base.dataFilter, enabled: true, kind: "fir", firCoefficients: [0.5, 0.5] },
      };
      resetStore(store, config);

      store.getState().addChartDataBatch(Array.from({ length: 20 }, (_, i) => point(0, i)));
      store.getState().addChartDataBatch([point(100, 20), point(100, 21), point(100, 22), point(100, 23)]);

      const after = store.getState();
      assert.equal(after.chartPaused, true, `${name}：开启滤波时也应能触发`);
      const raw = after.triggerCapture?.chartData ?? [];
      const processed = after.triggerCapture?.processedChartData ?? [];
      assert.equal(
        processed.length,
        raw.length,
        `${name}：原始与滤波后捕获画面长度必须一致，实际 ${raw.length} vs ${processed.length}`
      );
      assert.equal(raw.length, 8, `${name}：窗口模式下两者都应被裁到 pre + post`);

      // 时间戳应逐点对齐，否则图表把两条曲线画在错位的横坐标上
      raw.forEach((sample, index) => {
        assert.equal(processed[index].timestamp, sample.timestamp, `${name}：第 ${index} 点的原始与滤波后时间戳应对齐`);
      });
    }
    console.log("  开启滤波时：原始与滤波后捕获画面按同一窗口裁剪且逐点对齐");
  }

  // ---- 9) 串口的真实数据路径：commitSerialReceiveBatch ----
  //
  // 串口实时数据走的是 commitSerialReceiveBatch（要同时处理终端文本、日志行、
  // 字节统计和自动建通道），不是 addChartDataBatch。触发最初只接在后者上，
  // 于是「串口开触发完全不生效」——而上面所有用例走的都是 addChartDataBatch，
  // 正好避开了这个盲区。这一组专门覆盖真实路径。
  {
    const config = chartConfigWith({
      condition: "rising",
      level: 50,
      preSamples: 5,
      postSamples: 2,
      mode: "single",
      view: "window",
    });
    resetStore(useSerialStore, config);

    const commit = (points) =>
      useSerialStore.getState().commitSerialReceiveBatch({
        terminalText: "",
        lines: [],
        telemetryBatch: { points, success: points.length, fail: 0 },
        bytesReceived: 0,
      });

    commit(Array.from({ length: 20 }, (_, i) => point(0, i)));
    assert.equal(useSerialStore.getState().chartPaused, false, "未穿越时不应冻结");

    commit([point(100, 20), point(100, 21)]);
    const after = useSerialStore.getState();
    assert.equal(after.chartPaused, true, "串口真实路径上触发也必须生效");
    assert.equal(after.triggeredAt, 20, "触发点时间戳应正确");
    const captured = after.triggerCapture?.chartData ?? [];
    assert.equal(captured.length, 7, `窗口应为 pre + post = 7，实际 ${captured.length}`);
    assert.equal(after.triggerCapture?.processedChartData.length, captured.length, "两份捕获画面长度应一致");
    console.log("  串口真实路径 commitSerialReceiveBatch 上触发同样生效");
  }

  // ---- 10) 同一批数据在捕获完成后还有剩余样本：窗口必须结束在最后一个后置样本上 ----
  //
  // RTT 按帧合批，一批常含几十个样本。早先直接从缓冲区末尾切窗口，
  // 捕获完成之后的那些样本也被算进窗口，触发点因此偏离窗口里应在的位置。
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({
        condition: "rising",
        level: 50,
        preSamples: 5,
        postSamples: 3,
        mode: "single",
        view: "window",
      });
      resetStore(store, config);

      const batch = [
        ...Array.from({ length: 20 }, (_, i) => point(0, i)),
        point(100, 20),
        point(100, 21),
        point(100, 22),
        ...Array.from({ length: 10 }, (_, i) => point(0, 23 + i)),
      ];
      store.getState().addChartDataBatch(batch);

      const captured = store.getState().triggerCapture?.chartData ?? [];
      assert.deepEqual(
        captured.map(({ timestamp }) => timestamp),
        [15, 16, 17, 18, 19, 20, 21, 22],
        `${name}：窗口应为触发前 5 点 + 触发后 3 点，实际 ${captured.map(({ timestamp }) => timestamp)}`
      );
      assert.equal(store.getState().chartData.length, 33, `${name}：滚动缓冲区照常保留整批数据`);
    }
    console.log("  同批剩余样本不混进触发窗口，窗口精确结束在最后一个后置样本");
  }

  // ---- 11) 单次模式：恢复跟随后仍能重新武装，而不是只能清空数据 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({ condition: "above", level: 50, postSamples: 1, mode: "single" });
      resetStore(store, config);
      store.getState().addChartDataBatch([point(100, 0)]);
      assert.equal(store.getState().chartPaused, true);

      // 用户点「恢复跟随」
      store.getState().setChartPaused(false);
      const resumed = store.getState();
      assert.equal(resumed.triggerCapture, null, `${name}：恢复跟随应丢弃捕获画面，回到实时缓冲区`);
      assert.equal(resumed.triggeredAt, 0, `${name}：恢复跟随后仍保留触发点，界面据此继续提供重新武装`);

      // 单次模式已捕获：恢复跟随不等于重新武装
      store.getState().addChartDataBatch([point(100, 1)]);
      assert.equal(store.getState().chartPaused, false, `${name}：未重新武装前不应再次触发`);

      store.getState().rearmTrigger();
      store.getState().addChartDataBatch([point(100, 2)]);
      assert.equal(store.getState().chartPaused, true, `${name}：恢复跟随后重新武装应能再次触发`);
      assert.equal(store.getState().triggeredAt, 2);
    }
    console.log("  单次模式：恢复跟随后保留触发点，重新武装即可再次触发");
  }

  // ---- 12) 正常模式：冻结期间的后续捕获要刷新画面 ----
  {
    for (const [name, store] of STORES) {
      const config = chartConfigWith({
        condition: "rising",
        level: 50,
        preSamples: 2,
        postSamples: 2,
        mode: "normal",
        view: "window",
      });
      resetStore(store, config);

      store.getState().addChartDataBatch([point(0, 0), point(0, 1), point(100, 2), point(100, 3)]);
      const first = store.getState().triggerCapture;
      assert.equal(store.getState().triggeredAt, 2);

      store.getState().addChartDataBatch([point(0, 4), point(0, 5), point(100, 6), point(100, 7)]);
      const second = store.getState().triggerCapture;
      assert.equal(store.getState().chartPaused, true);
      assert.equal(store.getState().triggeredAt, 6, `${name}：正常模式应记录新的触发点`);
      assert.notEqual(second, first, `${name}：新的捕获应替换冻结画面`);
      assert.deepEqual(
        second.chartData.map(({ timestamp }) => timestamp),
        [4, 5, 6, 7],
        `${name}：冻结画面应换成最新一次的触发窗口`
      );
    }
    console.log("  正常模式：冻结期间每次新捕获都会刷新冻结画面");
  }

  // ---- 13) 切换单次 / 正常模式或开关触发：检测器重新待触发，旧触发点失效 ----
  {
    for (const [name, store] of STORES) {
      const single = chartConfigWith({ condition: "above", level: 50, postSamples: 1, mode: "single" });
      resetStore(store, single);
      store.getState().addChartDataBatch([point(100, 0)]);
      store.getState().setChartPaused(false);

      store.getState().setChartConfig({ ...single, trigger: { ...single.trigger, mode: "normal" } });
      assert.equal(store.getState().triggeredAt, null, `${name}：切换模式应清除旧触发点`);
      store.getState().addChartDataBatch([point(100, 1)]);
      assert.equal(store.getState().chartPaused, true, `${name}：切到正常模式后应能直接触发`);
    }
    console.log("  切换触发模式后检测器重新待触发，不会卡在旧的已捕获状态");
  }

  console.log("触发捕获 store 接线检查通过");
} finally {
  await server.close();
}
