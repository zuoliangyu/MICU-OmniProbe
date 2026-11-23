/**
 * RTT 图表查看器组件
 * 从 RttStore 获取数据并传递给通用 ChartViewer
 */

import { useRttStore } from "@/stores/rttStore";
import { ChartViewer } from "./ChartViewer";
import { useShallow } from "zustand/react/shallow";

export function RttChartViewer() {
  const {
    chartData,
    processedChartData,
    filterActive,
    chartConfig,
    chartPaused,
    triggeredAt,
    triggerCapture,
    parseSuccessCount,
    parseFailCount,
    setChartPaused,
    clearChartData,
    setChartConfig,
  } = useRttStore(
    useShallow((state) => ({
      chartData: state.chartData,
      processedChartData: state.processedChartData,
      filterActive: state.filterActive,
      chartConfig: state.chartConfig,
      chartPaused: state.chartPaused,
      triggeredAt: state.triggeredAt,
      triggerCapture: state.triggerCapture,
      parseSuccessCount: state.parseSuccessCount,
      parseFailCount: state.parseFailCount,
      setChartPaused: state.setChartPaused,
      clearChartData: state.clearChartData,
      setChartConfig: state.setChartConfig,
    }))
  );

  return (
    <ChartViewer
      source="rtt"
      chartData={chartData}
      processedData={processedChartData}
      filterActive={filterActive}
      chartConfig={chartConfig}
      chartPaused={chartPaused}
      parseSuccessCount={parseSuccessCount}
      parseFailCount={parseFailCount}
      setChartPaused={setChartPaused}
      clearChartData={clearChartData}
      setChartConfig={setChartConfig}
      triggeredAt={triggeredAt}
      triggerCapture={triggerCapture}
    />
  );
}
