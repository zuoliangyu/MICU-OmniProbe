# GD32 / STM32F407 RTT 示例工程

一个基于 STM32CubeMX 生成、集成了 SEGGER RTT 的最小工程，可直接在 Keil MDK 打开、烧录、用 MICU-OmniProbe 的 RTT 模式查看输出。

## 工程信息

- **目标芯片**：STM32F407VGTx（GD32F407 系列引脚兼容，可直接复用）
- **IDE**：Keil MDK-ARM v5
- **HAL 版本**：STM32F4xx_HAL_Driver
- **RTT 库**：已集成在 `RTT/` 目录（SEGGER_RTT v6+）

## 功能说明

`Core/Src/main.c` 在主循环里以 100ms 周期通过 RTT 输出一组 `x,y` 二维数据：

```c
for (int i = 0; i < 360; i++) {
    float angle = i * 3.14 / 180.0;
    int x = (int)(sin(angle) * 100);
    int y = (int)(sin(2 * angle) * 100);
    SEGGER_RTT_printf(0, "%d,%d\n", x, y);
    HAL_Delay(100);
}
```

输出是一组李萨如曲线坐标，配合 MICU-OmniProbe 的 RTT 图表模式能直接看到波形。

## 使用步骤

1. 用 Keil MDK 打开 `MDK-ARM/test.uvprojx`
2. 编译并烧录到 STM32F407 / GD32F407 开发板
3. 打开 MICU-OmniProbe，切到 RTT 模式
4. 选择探针和芯片，点「连接 RTT」→「启动」
5. 切到「图表」视图，点「智能启用」自动识别 XY 数据格式

## 移植到其他芯片

只需要替换 `Drivers/` 下的 HAL 库 + `MDK-ARM/startup_*.s` 为目标芯片对应的版本，`RTT/` 目录原样复制即可。
