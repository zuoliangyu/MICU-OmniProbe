# 示例工程

MICU-OmniProbe 的目标固件示例，方便快速验证 RTT / 烧录链路。

| 示例 | 平台 | 说明 |
|------|------|------|
| [`gd32-rtt/`](./gd32-rtt) | STM32F407 / GD32F407 + Keil MDK | RTT 输出李萨如曲线坐标，配合 RTT 模式的图表视图直接出波形 |

## 关于芯片定义包（CMSIS-Pack）

示例工程编译需要对应的设备 Pack。本仓库**不再附带 .pack 文件**——版本不一定最新，且涉及厂商许可。请按需到官方渠道获取：

- **STMicroelectronics**：在 Keil 的 `Pack Installer` 里直接搜索 `STM32F4xx_DFP` 安装
- **GigaDevice (GD32)**：[https://www.gd32mcu.com](https://www.gd32mcu.com) → 开发资源 → Keil 设备包
- **WHXY (CW32)**：[https://www.whxy.com](https://www.whxy.com) → 资源下载

MICU-OmniProbe 的烧录功能通过应用内的「Pack 导入」加载这些 Pack 文件，详见主 README 的 CMSIS-Pack 章节。
