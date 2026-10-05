# RTT 用户手册

RTT (Real-Time Transfer) 是 SEGGER 开发的一种高速调试输出技术，通过 SWD/JTAG 接口直接读写目标内存中的环形缓冲区，无需额外的串口硬件，传输速度比传统 UART 快数倍。

## 目录

- [快速开始](#快速开始)
- [文件说明](#文件说明)
- [集成步骤](#集成步骤)
- [API 参考](#api-参考)
- [彩色输出](#彩色输出)
- [常见问题](#常见问题)
- [最佳实践](#最佳实践)

---

## 快速开始

### 1. 获取 RTT 文件

RTT 需要在固件中加入 SEGGER 的 4 个目标端源文件。软件已内置这些文件，无需联网下载：

1. 切换到 **RTT 模式**。文本区没有数据时会显示 "固件还没接入 RTT？" 引导卡片
2. 点击 **导出 RTT 源文件**，选择固件工程里存放源码的目录
3. 目录中已有同名文件时会先询问是否覆盖

也可以从工具栏 **更多 → 接入指南** 打开完整的接入步骤，代码片段可一键复制。从源码仓库获取时，文件位于 `RTTBSP/` 目录：

```
RTTBSP/
├── SEGGER_RTT.c          # RTT 核心实现
├── SEGGER_RTT.h          # RTT 头文件
├── SEGGER_RTT_Conf.h     # RTT 配置文件
└── SEGGER_RTT_printf.c   # printf 实现
```

### 2. 添加到工程

**Keil MDK:**

1. 右键点击工程中的源文件组
2. 选择 "Add Existing Files..."
3. 添加 `SEGGER_RTT.c` 和 `SEGGER_RTT_printf.c`
4. 在 Options -> C/C++ -> Include Paths 中添加 RTT 文件所在目录

**STM32CubeIDE:**

1. 将文件复制到工程目录（如 `Core/Src/` 和 `Core/Inc/`）
2. 刷新工程目录
3. 文件会自动被识别

### 3. 编写代码

```c
#include "SEGGER_RTT.h"

int main(void) {
    // 系统初始化
    HAL_Init();
    SystemClock_Config();

    // RTT 初始化
    SEGGER_RTT_Init();
    SEGGER_RTT_printf(0, "RTT 初始化完成!\r\n");

    while(1) {
        SEGGER_RTT_printf(0, "Hello RTT! tick=%d\r\n", HAL_GetTick());
        HAL_Delay(100);
    }
}
```

### 4. 烧录并查看

1. 编译并烧录固件到目标芯片
2. 打开 MICU-OmniProbe 软件
3. 切换到 **RTT 模式**（点击左侧模式轨道的 RTT 按钮或按 `Ctrl+2`）
4. 在右侧配置检查器选择探针和目标芯片
5. 点击 "连接 RTT" 按钮建立连接（已在烧录工作台连接设备时可跳过，RTT 直接使用烧录连接）
6. 点击 "启动" 按钮开始接收数据
7. 需要留存输出时，在 RTT 文本区右键选择“保存当前窗口全部内容为 TXT”

### 控制块查找方式

点击 "启动" 按钮右侧的扫描模式按钮，可以选择软件如何找到固件里的 RTT 控制块（`_SEGGER_RTT`）：

| 模式         | 说明                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 自动扫描 RAM | 默认方式，无需配置。RAM 较大的芯片启动会慢一些                             |
| ELF 符号     | 选择固件的 ELF / AXF 文件，直接读取 `_SEGGER_RTT` 地址，启动最快           |
| 指定地址     | 填写控制块地址，可在 .map 文件中查 `_SEGGER_RTT`                           |
| 地址范围     | 只扫描给定的起始地址和大小，适合 RAM 很大或自动扫描读到无效区域的芯片     |

同一面板中还可以设置：

- **轮询间隔**：读取目标缓冲区的周期，默认 10 ms
- **失联等待**：目标复位、重新烧录或掉电后持续尝试重新附加的时间，默认 10 秒，超时后才停止
- **读取时暂停目标**：每次读取前暂停 CPU，会打断目标实时运行，仅在数据错乱时开启
- **核心**：多核芯片选择控制块所在的核心
- **文本区保留行数**：1 万 / 5 万 / 20 万行

设置会自动保存，RTT 运行中修改的设置在下次启动时生效。

### 烧录后自动恢复

RTT 运行期间可以直接在烧录工作台烧录或擦除，无需先停止 RTT：

- 烧录、擦除、校验期间 RTT 暂停读取，不会和烧录争用探针
- 烧录完成后自动重新查找控制块。新固件的控制块地址变了也能找到（ELF 模式会重新读取 ELF 中的符号）
- 恢复期间面板上方显示提示，状态栏显示 "重新附加中"，恢复后自动继续接收

### 暂停显示

"暂停显示" 只冻结文本区，数据仍在后台接收、录制和绘图。按钮上会显示暂停期间缓存的行数，点击 "继续" 后一次性补上。停止 RTT 时自动解除暂停。

### 向目标发送数据

固件配置了下行通道（`SEGGER_RTT_MAX_NUM_DOWN_BUFFERS` 大于 0）时，RTT 运行后文本区下方会出现发送栏：

- 输入文本后按 Enter 发送，上下方向键切换发送历史
- 在 "发送选项" 中切换 HEX 模式、编码（UTF-8 / ASCII / GBK）和换行符
- 有多个下行通道时可以选择目标通道
- 发送的内容以蓝色 `[→通道号]` 显示在文本区

固件侧读取示例：

```c
char cmd[32];
unsigned len = SEGGER_RTT_Read(0, cmd, sizeof(cmd) - 1);
if (len > 0) {
    cmd[len] = '\0';
    // 处理命令
}
```

目标长时间不读取下行缓冲区时，发送队列满后会提示错误。

---

## 文件说明

| 文件                  | 说明                                      |
| --------------------- | ----------------------------------------- |
| `SEGGER_RTT.c`        | RTT 核心实现，包含缓冲区管理和读写函数    |
| `SEGGER_RTT.h`        | RTT API 声明                              |
| `SEGGER_RTT_Conf.h`   | 配置文件，可修改缓冲区大小、通道数量等    |
| `SEGGER_RTT_printf.c` | 实现 `SEGGER_RTT_printf()` 格式化输出函数 |

---

## 集成步骤

### 基本配置

默认配置适用于大多数场景。如需自定义，修改 `SEGGER_RTT_Conf.h`：

```c
// 上行缓冲区大小（目标 -> 主机），默认 1024 字节
// 如果数据丢失，可以增大此值
#define BUFFER_SIZE_UP    4096

// 下行缓冲区大小（主机 -> 目标），默认 16 字节
#define BUFFER_SIZE_DOWN  16

// 最大上行通道数，默认 3
#define SEGGER_RTT_MAX_NUM_UP_BUFFERS    3

// 最大下行通道数，默认 3
#define SEGGER_RTT_MAX_NUM_DOWN_BUFFERS  3
```

### 缓冲区模式

RTT 支持三种缓冲区模式，**强烈建议使用非阻塞模式**：

```c
// 模式 0: 跳过 - 缓冲区满时丢弃新数据（推荐）
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);

// 模式 1: 截断 - 缓冲区满时截断数据
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_TRIM);

// 模式 2: 阻塞 - 缓冲区满时阻塞等待（不推荐，可能导致程序卡死）
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_BLOCK_IF_FIFO_FULL);
```

---

## API 参考

### 初始化

```c
void SEGGER_RTT_Init(void);
```

初始化 RTT，在使用其他 RTT 函数前必须调用。

### 格式化输出

```c
int SEGGER_RTT_printf(unsigned BufferIndex, const char *sFormat, ...);
```

类似标准 `printf()`，将格式化字符串输出到指定通道。

**参数：**

- `BufferIndex` - 通道索引，通常使用 0
- `sFormat` - 格式化字符串
- `...` - 可变参数

**返回值：** 写入的字符数

**示例：**

```c
int value = 42;
float temperature = 25.5f;

SEGGER_RTT_printf(0, "整数: %d\r\n", value);
SEGGER_RTT_printf(0, "十六进制: 0x%08X\r\n", value);
SEGGER_RTT_printf(0, "浮点数: %d.%d\r\n", (int)temperature, (int)(temperature*10)%10);
```

> **注意：** `SEGGER_RTT_printf` 不支持 `%f` 格式符，浮点数需要手动转换。

### 字符串输出

```c
unsigned SEGGER_RTT_WriteString(unsigned BufferIndex, const char *s);
```

输出字符串（不支持格式化）。

**示例：**

```c
SEGGER_RTT_WriteString(0, "Hello World!\r\n");
```

### 二进制数据输出

```c
unsigned SEGGER_RTT_Write(unsigned BufferIndex, const void *pBuffer, unsigned NumBytes);
```

输出二进制数据。

**示例：**

```c
uint8_t data[] = {0x01, 0x02, 0x03, 0x04};
SEGGER_RTT_Write(0, data, sizeof(data));
```

### 配置通道

```c
int SEGGER_RTT_ConfigUpBuffer(unsigned BufferIndex, const char *sName,
                               void *pBuffer, unsigned BufferSize, unsigned Flags);
```

配置上行通道（目标 -> 主机）。

**参数：**

- `BufferIndex` - 通道索引
- `sName` - 通道名称（可为 NULL）
- `pBuffer` - 自定义缓冲区（NULL 使用默认）
- `BufferSize` - 缓冲区大小（0 使用默认）
- `Flags` - 模式标志

**示例：**

```c
// 配置通道 0 为非阻塞模式
SEGGER_RTT_ConfigUpBuffer(0, "Terminal", NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);

// 使用自定义大缓冲区
static char bigBuffer[8192];
SEGGER_RTT_ConfigUpBuffer(1, "DataLog", bigBuffer, sizeof(bigBuffer), SEGGER_RTT_MODE_NO_BLOCK_SKIP);
```

---

## 彩色输出

RTT 终端支持 ANSI 转义序列，可以输出彩色文本。

### 颜色代码

| 代码       | 颜色 |
| ---------- | ---- |
| `\x1b[30m` | 黑色 |
| `\x1b[31m` | 红色 |
| `\x1b[32m` | 绿色 |
| `\x1b[33m` | 黄色 |
| `\x1b[34m` | 蓝色 |
| `\x1b[35m` | 紫色 |
| `\x1b[36m` | 青色 |
| `\x1b[37m` | 白色 |
| `\x1b[0m`  | 重置 |

### 样式代码

| 代码      | 效果         |
| --------- | ------------ |
| `\x1b[1m` | 粗体         |
| `\x1b[0m` | 重置所有样式 |

### 背景色代码

| 代码       | 颜色     |
| ---------- | -------- |
| `\x1b[40m` | 黑色背景 |
| `\x1b[41m` | 红色背景 |
| `\x1b[42m` | 绿色背景 |
| `\x1b[43m` | 黄色背景 |
| `\x1b[44m` | 蓝色背景 |
| `\x1b[45m` | 紫色背景 |
| `\x1b[46m` | 青色背景 |
| `\x1b[47m` | 白色背景 |

### 使用示例

```c
// 定义颜色宏
#define RTT_CTRL_RESET     "\x1b[0m"
#define RTT_CTRL_RED       "\x1b[31m"
#define RTT_CTRL_GREEN     "\x1b[32m"
#define RTT_CTRL_YELLOW    "\x1b[33m"
#define RTT_CTRL_BLUE      "\x1b[34m"
#define RTT_CTRL_BOLD      "\x1b[1m"

// 彩色日志输出
SEGGER_RTT_printf(0, RTT_CTRL_RED "[ERROR] " RTT_CTRL_RESET "发生错误!\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_GREEN "[OK] " RTT_CTRL_RESET "操作成功\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_YELLOW "[WARN] " RTT_CTRL_RESET "警告信息\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_BLUE "[INFO] " RTT_CTRL_RESET "普通信息\r\n");

// 组合使用
SEGGER_RTT_printf(0, RTT_CTRL_BOLD RTT_CTRL_RED "严重错误!" RTT_CTRL_RESET "\r\n");

// 背景色
SEGGER_RTT_printf(0, "\x1b[44;37m 蓝底白字 \x1b[0m\r\n");
```

### 封装日志宏

```c
#define LOG_ERROR(fmt, ...)   SEGGER_RTT_printf(0, "\x1b[31m[ERROR] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_WARN(fmt, ...)    SEGGER_RTT_printf(0, "\x1b[33m[WARN]  " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_INFO(fmt, ...)    SEGGER_RTT_printf(0, "\x1b[32m[INFO]  " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_DEBUG(fmt, ...)   SEGGER_RTT_printf(0, "\x1b[36m[DEBUG] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)

// 使用
LOG_ERROR("传感器初始化失败，错误码: %d", err);
LOG_WARN("电池电量低: %d%%", battery_level);
LOG_INFO("系统启动完成");
LOG_DEBUG("变量值: x=%d, y=%d", x, y);
```

---

## 常见问题

### 1. 启动后没有数据显示

**可能原因：**

- 目标固件没有调用 `SEGGER_RTT_Init()`
- RTT 文件没有正确添加到工程
- 目标芯片没有运行

**解决方法：**

1. 确保代码中调用了 `SEGGER_RTT_Init()`
2. 检查编译是否包含 RTT 源文件
3. 确保目标芯片复位后正常运行

### 2. 数据接收断断续续或卡死

**原因：** RTT 缓冲区满时目标程序被阻塞

**解决方法：** 配置为非阻塞模式

```c
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);
```

### 3. 数据丢失

**原因：** 缓冲区太小，数据产生速度超过读取速度

**解决方法：**

1. 增大缓冲区（修改 `SEGGER_RTT_Conf.h`）
   ```c
   #define BUFFER_SIZE_UP    4096  // 增大到 4KB
   ```
2. 减少打印频率
3. 减少单次打印的数据量

### 4. 找不到 RTT 控制块

**原因：** 控制块尚未初始化、不在扫描范围内，或 RAM 太大扫描超时

**解决方法：**

1. 确认目标正在运行，且已执行过 `SEGGER_RTT_Init()`
2. 点击 "启动" 右侧的扫描模式按钮，改用 "ELF 符号" 并选择固件 ELF / AXF 文件
3. 或改用 "指定地址"，填写 .map 文件中 `_SEGGER_RTT` 的地址
4. 错误提示 "找到多个 RTT 控制块" 时，改用指定地址或 ELF 符号模式

### 5. 浮点数无法打印

**原因：** `SEGGER_RTT_printf` 不支持 `%f` 格式符

**解决方法：** 手动转换

```c
float temp = 25.75f;
// 错误: SEGGER_RTT_printf(0, "温度: %f\r\n", temp);

// 正确:
int int_part = (int)temp;
int dec_part = (int)((temp - int_part) * 100);
SEGGER_RTT_printf(0, "温度: %d.%02d\r\n", int_part, dec_part);
```

---

## 最佳实践

### 1. 初始化模板

```c
void RTT_Init(void) {
    SEGGER_RTT_Init();

    // 配置通道 0 为非阻塞模式
    SEGGER_RTT_ConfigUpBuffer(0, "Terminal", NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);

    // 打印启动信息
    SEGGER_RTT_WriteString(0, "\r\n");
    SEGGER_RTT_WriteString(0, "================================\r\n");
    SEGGER_RTT_WriteString(0, "  RTT Terminal Ready\r\n");
    SEGGER_RTT_WriteString(0, "================================\r\n");
}
```

### 2. 条件编译

```c
#ifdef USE_RTT_DEBUG
    #define RTT_PRINTF(...)  SEGGER_RTT_printf(0, __VA_ARGS__)
#else
    #define RTT_PRINTF(...)  ((void)0)
#endif
```

### 3. 性能优化

```c
// 避免在中断中频繁打印
void TIM_IRQHandler(void) {
    static uint32_t count = 0;

    // 每 1000 次才打印一次
    if (++count >= 1000) {
        count = 0;
        SEGGER_RTT_printf(0, "定时器中断计数: %d\r\n", total_count);
    }
}
```

### 4. 多通道使用

```c
// 通道 0: 普通日志
// 通道 1: 数据记录
// 通道 2: 调试信息

void MultiChannel_Init(void) {
    SEGGER_RTT_Init();

    SEGGER_RTT_ConfigUpBuffer(0, "Log", NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);
    SEGGER_RTT_ConfigUpBuffer(1, "Data", NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);
    SEGGER_RTT_ConfigUpBuffer(2, "Debug", NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);
}

// 使用不同通道
SEGGER_RTT_printf(0, "[LOG] 系统事件\r\n");
SEGGER_RTT_printf(1, "%d,%d,%d\r\n", sensor1, sensor2, sensor3);  // CSV 格式数据
SEGGER_RTT_printf(2, "[DBG] 调试变量: %d\r\n", debug_var);
```

---

## 完整示例

```c
#include "main.h"
#include "SEGGER_RTT.h"

// 日志宏定义
#define LOG_E(fmt, ...)  SEGGER_RTT_printf(0, "\x1b[31m[E] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_W(fmt, ...)  SEGGER_RTT_printf(0, "\x1b[33m[W] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_I(fmt, ...)  SEGGER_RTT_printf(0, "\x1b[32m[I] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)
#define LOG_D(fmt, ...)  SEGGER_RTT_printf(0, "\x1b[36m[D] " fmt "\x1b[0m\r\n", ##__VA_ARGS__)

int main(void) {
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();

    // RTT 初始化
    SEGGER_RTT_Init();
    SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);

    LOG_I("============================");
    LOG_I("  MICU-OmniProbe RTT Demo");
    LOG_I("============================");
    LOG_I("系统时钟: %d MHz", SystemCoreClock / 1000000);

    uint32_t loop_count = 0;

    while (1) {
        loop_count++;

        // 演示不同级别的日志
        if (loop_count % 10 == 0) {
            LOG_D("循环计数: %d", loop_count);
        }

        if (loop_count % 50 == 0) {
            LOG_I("运行时间: %d ms", HAL_GetTick());
        }

        if (loop_count % 100 == 0) {
            LOG_W("这是一条警告消息");
        }

        if (loop_count % 200 == 0) {
            LOG_E("这是一条错误消息（演示用）");
        }

        // LED 闪烁
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        HAL_Delay(100);
    }
}
```

---

## 参考资料

- [SEGGER RTT 官方文档](https://www.segger.com/products/debug-probes/j-link/technology/about-real-time-transfer/)
- [probe-rs 文档](https://probe.rs/)
- [MICU-OmniProbe 项目主页](https://github.com/zuoliangyu/MICU-OmniProbe)
