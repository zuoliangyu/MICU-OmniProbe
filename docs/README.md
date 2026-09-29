# MICU-OmniProbe 用户文档

从这里开始了解 MICU-OmniProbe。文档优先回答两个问题：**功能需要什么输入**，以及**输入默认流向哪里**。

> 第一次使用建议先看 [快速入门](QUICK_START.md)。需要驱动波形、FFT、数据显示或 IMU 时，直接查看 [输入数据解析格式](DATA_FORMAT_GUIDE.md)。

## 最常用的两本手册

| 我想做什么                                              | 从这里开始                                    |
| ------------------------------------------------------- | --------------------------------------------- |
| 配置文本、通用二进制、JustFloat、CAN 或 Modbus 数据输入 | [输入数据解析格式](DATA_FORMAT_GUIDE.md)      |
| 配置发送按钮、滑块、摇杆、FFT、XY 或 IMU 等控制面板组件 | [控制面板组件](SERIAL_CONTROL_PANEL_GUIDE.md) |

## 按工作流查找

### 快速开始

- [快速入门](QUICK_START.md)：认识界面、连接探针并完成第一次操作。
- [设置中心](SETTINGS_GUIDE.md)：主题、启动工作台、默认视图和日志面板。
- [自动更新](UPDATE_GUIDE.md)：检查、下载并安装新版本，以及更新失败时的处理。

### 数据与串口

- [日志分析](LOG_ANALYSIS_GUIDE.md)：导入 UTF-8 日志文件，搜索正文并解析数值图表。
- [输入数据解析格式](DATA_FORMAT_GUIDE.md)：自动、JSON、KV、分隔符、正则、通用二进制协议、JustFloat、经典 CAN / CAN FD、DBC，以及 Modbus RTU、ASCII 和 TCP。
- [数据滤波与 MATLAB 参数](MATLAB_FILTER_GUIDE.md)：图形化级联低通、高通、带通，预览和导出参数，或导入 FIR 与 SOS/ScaleValues。
- [控制面板组件](SERIAL_CONTROL_PANEL_GUIDE.md)：独立面板工作台、串口/RTT 数据来源及全部 15 种组件。
- [串口终端](SERIAL_TERMINAL_GUIDE.md)：串口、TCP、UDP、模拟数据、日志、终端交互和文件发送。
- [无线串口透传接入](WIRELESS_SERIAL_GUIDE.md)：Zigbee、LoRa、蓝牙透传等模块按串口接入，以及吞吐、分帧和二进制透传注意事项。
- [采集会话录制与回放](SESSION_RECORD_GUIDE.md)：把一段采集录成 .ekrec 文件，之后换一套解析或滤波配置重新跑同一份数据。
- [触发捕获](TRIGGER_CAPTURE_GUIDE.md)：条件成立时自动冻结图表，留住事件发生前后的数据。
- [AI 数据桥接](AI_TUNING_GUIDE.md)：把串口文本和已经解析的数值通道提供给本机 AI 工具。

### RTT 与图表

- [RTT 用户手册](RTT_USER_MANUAL.md)：固件集成、API、通道与常见问题。
- [RTT 图表与波形](RTT_CHART_GUIDE.md)：时域、FFT 和普通图表。
- [RTT XY 散点图](RTT_XY_SCATTER_GUIDE.md)：XY 数据格式与配置。

### 蓝牙

- [蓝牙用户手册](BLUETOOTH_USER_MANUAL.md)：BLE Notify、写入、图表和经典蓝牙 SPP。

## 文档约定

- “输入样本”表示设备或数据源实际发送的一帧数据。
- “通道 key”表示解析后供图表和组件绑定的字段名。
- “默认数据流”表示不增加自定义脚本时，数据在应用内经过的路径。
- 文档只描述当前版本已实现的功能；暂不可用的界面入口会明确标注。
