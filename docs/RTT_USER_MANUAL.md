# RTT 用户手册

RTT (Real-Time Transfer) 是 SEGGER 开发的一种高速调试输出技术，通过 SWD/JTAG 接口直接读写目标内存中的环形缓冲区，无需额外的串口硬件，传输速度比传统 UART 快数倍。

## 目录

- [快速开始](#快速开始)
- [界面总览](#界面总览)
- [连接方式](#连接方式)
- [启动设置](#启动设置)
- [烧录后自动恢复](#烧录后自动恢复)
- [Bootloader 与 App 切换](#bootloader-与-app-切换)
- [文本区](#文本区)
- [接收分帧](#接收分帧)
- [向目标发送数据](#向目标发送数据)
- [更多菜单一览](#更多菜单一览)
- [快捷键](#快捷键)
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
3. 目录中已有同名文件时会先询问是否覆盖；选择不覆盖则不写入任何文件

完整的接入步骤可以从以下位置打开 **RTT 接入指南** 对话框，代码片段右上角点 "复制" 即可复制：

- 应用右上角的 **接入指南**（任意工作台都可打开）
- 文本区空状态引导卡片里的 **接入指南**

接入指南里还提供 "仓库内 RTTBSP/ 目录" 和 "examples/gd32-rtt 完整工程" 两个外部链接。从源码仓库获取时，文件位于 `RTTBSP/` 目录：

```
RTTBSP/
├── SEGGER_RTT.c          # RTT 核心实现
├── SEGGER_RTT.h          # RTT 头文件
├── SEGGER_RTT_Conf.h     # RTT 配置文件
└── SEGGER_RTT_printf.c   # printf 实现
```

> 仓库的 `examples/gd32-rtt/` 是一个已集成 RTT 的 STM32F407 / GD32F407 Keil 工程，主循环输出李萨如曲线坐标 `x,y`，烧录后在 RTT 工作台点 "智能启用" 即可看到 XY 图形，可用来快速验证探针和 RTT 链路。

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

裸机、FreeRTOS、RT-Thread 都可以直接使用，不需要额外适配；RTT 也不依赖具体芯片库，HAL、标准库、GD32 固件库用法相同。

### 3. 编写代码

```c
#include "SEGGER_RTT.h"

int main(void) {
    // 系统初始化
    HAL_Init();
    SystemClock_Config();

    // RTT 初始化（尽早调用，上位机能更快找到控制块）
    SEGGER_RTT_Init();
    SEGGER_RTT_printf(0, "RTT 初始化完成!\r\n");

    while(1) {
        SEGGER_RTT_printf(0, "Hello RTT! tick=%d\r\n", HAL_GetTick());
        HAL_Delay(100);
    }
}
```

通道 0 是默认的终端通道。软件会读取固件中所有上行通道，在状态栏可以按通道筛选显示。

### 4. 烧录并查看

1. 编译并烧录固件到目标芯片，让目标正常运行（不要停在断点或复位状态）
2. 打开 MICU-OmniProbe 软件
3. 切换到 **RTT 模式**（点击左侧模式轨道的 RTT 按钮或按 `Ctrl+2`）
4. 在右侧配置检查器选择探针和目标芯片
5. 点击 "连接 RTT" 按钮建立连接（已在烧录工作台连接设备时可跳过，RTT 直接使用烧录连接，见 [连接方式](#连接方式)）
6. 点击 "启动" 按钮开始查找控制块并接收数据
7. 需要留存输出时，在 **更多 → 输出** 中点击 "导出 TXT" / "导出 CSV"，或在文本区右键选择 "保存当前窗口全部内容为 TXT"

启动成功后，输出日志会记录控制块的查找方式、地址、所用连接，以及每个上行 / 下行通道的名称和缓冲区大小。

---

## 界面总览

RTT 工作台从上到下依次是：

| 区域 | 内容 |
| ---- | ---- |
| 工具栏 | 连接 RTT / 断开 RTT、启动 / 停止、查找方式按钮（启动设置）、暂停显示、清空、文本 / 分屏 / 图表 视图切换、搜索框、更多 |
| 提示条 | 出错时显示 "RTT 工作流出现错误"；目标复位或烧录后显示重新附加提示 |
| 文本区 / 图表区 | 文本区显示原始 RTT 输出；图表区用法见 [RTT 图表与波形](RTT_CHART_GUIDE.md) |
| 发送栏 | 固件有下行通道且 RTT 运行时出现，见 [向目标发送数据](#向目标发送数据) |
| 状态栏 | 运行状态、控制块地址、通道筛选、行数、接收字节数 |

### 工具栏按钮

| 按钮 | 说明 |
| ---- | ---- |
| 连接 RTT / 断开 RTT | 建立或释放独立的 RTT 探针连接。连接时使用右侧配置检查器中的探针、芯片型号、接口（SWD / JTAG）、时钟速度和连接模式 |
| 启动 / 停止 | 启动会查找控制块并开始轮询；查找期间按钮变为 "取消启动"，可随时中止。既没有 RTT 连接也没有烧录连接时 "启动" 不可用 |
| 查找方式按钮 | 位于 "启动" 右侧，按钮文字显示当前扫描模式（默认 "自动扫描 RAM"），点击打开 "RTT 启动设置"，见 [启动设置](#启动设置) |
| 暂停显示 / 继续 | 只冻结文本区，见 [暂停显示](#暂停显示) |
| 清空 | 清空文本区的行、行数和接收字节统计。图表数据不受影响，图表有自己的 "清空数据" |
| 文本 / 分屏 / 图表 | 切换为仅文本、文本 + 图表分屏、仅图表。分屏时可在 **更多 → 工作流** 中选择 "上下分屏" 或 "左右分屏"，拖动中间分隔条调整比例 |
| 搜索 RTT... | 按关键字过滤文本区，见 [搜索与定位](#搜索与定位) |
| 更多 | 分析、显示、配置和导出功能，见 [更多菜单一览](#更多菜单一览) |

### 状态栏

| 项目 | 说明 |
| ---- | ---- |
| 运行状态 | 查找控制块... / 运行中 / 显示已暂停 / 重新附加中 / 已停止 |
| 控制块地址 | 运行时显示 `控制块 0x2000xxxx`，鼠标悬停可看到查找方式，以及使用的是 "使用烧录连接" 还是 "独立 RTT 连接" |
| 通道 | 选择 "全部" 或某个上行通道（显示为 `通道号: 名称`，未命名的显示 "(未命名)"）。只过滤接收的数据，自己发送的记录始终显示 |
| 行数 / 接收 | 文本区当前保留的行数和累计接收字节数 |

---

## 连接方式

RTT 可以使用两种探针连接：

- **独立 RTT 连接**：在 RTT 工作台点击 "连接 RTT" 建立，与烧录工作台的连接互不影响
- **烧录连接**：已在烧录工作台连接设备时，无需再点 "连接 RTT"，直接点 "启动" 即可借用这条连接，同一个探针不用打开两次

两者同时存在时优先使用独立 RTT 连接。启动成功的日志和状态栏的控制块地址提示中会注明本次使用的是哪一种。

注意事项：

- 借用烧录连接运行时，在烧录工作台断开或重新连接设备会让 RTT 停止
- 点击 "断开 RTT" 时，如果 RTT 正在使用这条独立连接运行，会先停止 RTT
- 多核芯片的核心数取自当前使用的连接，大于 1 时启动设置中才会出现 "核心" 选项

---

## 启动设置

点击 "启动" 按钮右侧的查找方式按钮打开 **RTT 启动设置**。设置会自动保存；RTT 运行或启动中这些选项只读，修改在下次启动时生效（"文本区保留行数" 除外，修改后立即生效）。

### 控制块查找方式

"扫描模式" 决定软件如何找到固件里的 RTT 控制块（`_SEGGER_RTT`）：

| 模式         | 说明                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| 自动扫描 RAM | 默认方式，无需配置，扫描芯片的全部 RAM 区域。RAM 较大的芯片启动会慢一些                  |
| ELF 符号     | 选择固件的 ELF / AXF / OUT 文件，直接读取 `_SEGGER_RTT` 地址，启动最快；重新烧录后自动按新固件查找 |
| 指定地址     | 填写控制块地址，直接读取该地址，可在 .map 文件中查 `_SEGGER_RTT`                          |
| 地址范围     | 只扫描给定的起始地址和大小，适合 RAM 很大或自动扫描读到无效区域的芯片                    |

各模式的附加选项：

- **ELF 符号**：点击 "选择文件" 选取固件文件，路径显示在上方（未选择时显示 "尚未选择"）。如果烧录工作台当前选择的固件就是 ELF / AXF / OUT 文件，会多出 "使用烧录固件" 按钮，一键填入。未选择文件时点击 "启动" 会提示 "ELF 模式需要先选择固件 ELF / AXF 文件"；文件里没有 `_SEGGER_RTT` 符号时会提示选择带符号的 ELF / AXF
- **指定地址**：在 "控制块地址" 中填写十六进制地址，可带或不带 `0x` 前缀，默认 `0x20000000`。输入框失焦或按 Enter 时校验，格式错误时框线变红且不保存
- **地址范围**：填写 "起始地址"（默认 `0x20000000`）和 "范围大小 (字节)"（十六进制，默认 `0x00010000`，即 64 KB）

RAM 中同时存在多个控制块（例如 Bootloader 和 App 各一个）时，自动扫描和地址范围模式会优先选择有待读数据的那个，都没有数据时取地址最低的一个。

### 其他选项

| 选项 | 默认值 | 说明 |
| ---- | ------ | ---- |
| 核心 | 核心 0 | 仅多核芯片显示，选择控制块所在的核心 |
| 轮询间隔 (ms) | 10 | 读取目标缓冲区的周期，范围 1~1000。间隔越小延迟越低，探针占用也越高 |
| 失联等待 (秒) | 10 | 目标复位、重新烧录或掉电后，在等待时间内持续尝试重新附加，超时才停止，范围 1~600 |
| 读取时暂停目标 | 关闭 | 每次读取前暂停 CPU、读完再恢复，会打断目标实时运行，仅在数据错乱时开启 |
| 文本区保留行数 | 1 万行 | 可选 1 万 / 5 万 / 20 万行，超出后丢弃最早的行。调小时立即裁剪已有内容 |

---

## 烧录后自动恢复

RTT 运行期间可以直接在烧录工作台烧录或擦除，无需先停止 RTT：

- 烧录、擦除、校验、读取 Flash 期间 RTT 暂停读取，不会和烧录争用探针
- 烧录或擦除完成后自动重新查找控制块。新固件的控制块地址变了也能找到（ELF 模式会重新读取 ELF 中的符号；指定地址模式在原地址失效时会改为扫描整片 RAM）
- 恢复期间面板上方显示 "目标已复位或正在更新固件，正在重新查找 RTT 控制块，恢复后自动继续接收"，状态栏显示 "重新附加中"，恢复后自动继续接收
- 目标复位、掉电等导致读取失败时同样会进入 "重新附加中"，持续超过 "失联等待" 设定的时间后 RTT 停止，并提示 "目标失联超过 N 秒，RTT 已停止"

> 运行中从 RTT 切换到烧录工作台时会弹出确认框，确认后即可开始烧录。

---

## Bootloader 与 App 切换

Bootloader 和 App 都使用 RTT 时，两者的控制块通常在不同地址。跳转到 App（或复位回到 Bootloader）后，旧控制块常常原样留在 RAM 里，此前需要手动重新连接才能看到新固件的输出。

现在 RTT 在一段时间（约 1 秒）没有收到数据时，会自动检查控制块：

- 原控制块已被新固件覆盖：重新查找控制块
- 原控制块还在，但另一个控制块里有新数据：自动切换过去

切换后输出日志会记录新旧地址（"RTT 控制块已切换：旧地址 → 新地址"），状态栏显示新的控制块地址，无需停止或重新连接。

- "自动扫描 RAM" 和 "地址范围" 模式下自动生效；扫描范围需要同时覆盖两个控制块
- "指定地址" 和 "ELF 符号" 模式只在原控制块失效时才重新查找；两份固件交替运行时建议改用自动扫描
- 开启 "读取时暂停目标" 时不做空闲检查，避免长时间暂停目标

自动切换要等空闲约 1 秒后才检查，所以有两种情况会漏掉 Bootloader 的日志：

- 使用 "指定地址" 或 "ELF 符号" 模式，填的是 App 的控制块地址。复位回到 Bootloader 后 App 的控制块仍完好地留在 RAM 里，工具会一直读这个地址，看不到 Bootloader 的输出
- Bootloader 运行时间很短（不到 1~2 秒）就跳转。App 启动时清零 RAM 或调用 `SEGGER_RTT_Init()`，Bootloader 还没被读走的日志就没了

想要从 Bootloader 到 App 完整、连续地看到日志，建议让两份固件共用同一个控制块：

1. 在两个工程的分散加载文件（`.sct`）或链接脚本里，在 RAM 末尾划出同一段**不初始化**（`UNINIT` / `NOLOAD`）的区域，并相应缩小普通 RAM 区，避免栈压到这段区域
2. 两边的 `SEGGER_RTT_Conf.h` 保持一致：通道数、缓冲区大小相同，`SEGGER_RTT_SECTION` 和 `SEGGER_RTT_BUFFER_SECTION` 都放进这段区域，控制块和缓冲区的地址就完全相同
3. Bootloader 照常调用 `SEGGER_RTT_Init()`；App 已被 Bootloader 初始化过时**不要再次初始化**，否则 Bootloader 尚未读走的日志会被清空：

   ```c
   #include <string.h>

   /* App 的 main() 开头 */
   if (memcmp((const void *)_SEGGER_RTT.acID, "SEGGER RTT", 10) != 0) {
       SEGGER_RTT_Init();   /* 冷启动：控制块还不存在才初始化 */
   }
   ```

4. 在工具里改用 "指定地址"，填写这段区域中 `_SEGGER_RTT` 的地址（以 `.map` 文件为准）

两份固件写的都是同一个控制块，复位或跳转都不需要切换，日志从 Bootloader 到 App 连续显示。

> 判断时比较完整的 `"SEGGER RTT"` 标识，而不是只看第一个字符：上电后不初始化区域里是随机数据，只看一个字节可能误判成已初始化。

---

## 文本区

### 行格式

每行依次显示：

- 时间戳 `[HH:mm:ss.SSS]`：上位机收到这批数据的本机时间，不是目标端时间。同一次轮询读到的多行时间戳相同
- 通道号：接收的行显示 `[0]`、`[1]` 等；自己发送的行以蓝色 `[→通道号]` 显示
- 内容：按 [彩色输出](#彩色输出) 和颜色标记着色

只含空白字符的行不会显示。

### 日志级别着色

行内包含以下关键字（不区分大小写）时，整行按级别着色：

| 关键字 | 颜色 |
| ------ | ---- |
| `[error]`、`[err]`、`error:` | 红色 |
| `[warn]`、`[warning]`、`warning:` | 黄色 |
| `[debug]`、`[dbg]` | 蓝色 |

ANSI 颜色码和颜色标记会在此基础上覆盖对应片段的颜色。

### 文本 / Hex 显示

**更多 → 查看** 中的显示模式按钮在 "文本" 和 "Hex" 之间切换，按钮文字显示当前模式。Hex 模式把每行的原始字节显示为 `48 65 6C 6C 6F` 形式，适合排查不可见字符或二进制数据。

### 自动滚动

**更多 → 查看 → 自动滚动** 默认开启。开启时只有视图停在底部才跟随新数据；往上翻看历史时自动暂停跟随，右下角出现 "回到最新" 按钮，点击即可回到底部并恢复跟随。

### 暂停显示

"暂停显示" 只冻结文本区，数据仍在后台接收、录制和绘图。按钮会变为 "继续"，并显示暂停期间缓存的行数（如 `继续 (+1,234)`），点击后一次性补上。

- 暂停期间缓存的行数最多等于 "文本区保留行数"，超出时只保留最新的部分
- 暂停中点击 "清空" 会同时丢弃缓存
- 停止 RTT 时自动解除暂停

### 搜索与定位

- **搜索 RTT...**：工具栏搜索框，输入关键字后文本区只显示包含该关键字的行（不区分大小写），自己发送的记录同样参与过滤。按 `Ctrl+F` 可快速聚焦搜索框
- **定位栏**：文本区底部的工具条，不过滤其他行，只跳转和高亮：
  - 时间框输入 `HH:mm:ss.SSS`（或 `YYYY-MM-DD HH:mm:ss.SSS`）后点 "跳转"，定位到时间最接近的一行，并提示偏差毫秒数
  - 选择 "文本" 或 "HEX" 查找方式，输入文本或字节序列（如 `AA 55 01`），点 "上一个" / "下一个"（或 `Shift+Enter` / `Enter`）在匹配行之间跳转，右侧显示 `第几个 / 共几个`
  - 定位后自动滚动暂停，点 "取消定位" 清除标记并回到最新数据

### 复制与导出

| 操作 | 入口 | 内容 |
| ---- | ---- | ---- |
| 复制选区 | 在文本区拖选多行后按 `Ctrl+C`；在文本区内按 `Ctrl+A` 全选 | 选中的行，含时间戳和通道号 |
| 复制全部 | 更多 → 输出 → 复制全部 | 当前通道筛选和搜索结果下的全部行 |
| 导出 TXT | 更多 → 输出 → 导出 TXT | 文本区保留的全部行（不受筛选和搜索影响），每行格式 `[时间] [CH通道号] 内容` |
| 导出 CSV | 更多 → 输出 → 导出 CSV | 文本区保留的全部行，列为 `timestamp,channel,level,text`，时间为 ISO 格式 |
| 保存当前窗口 | 文本区右键 → 保存当前窗口全部内容为 TXT | 当前筛选和搜索结果下的全部行；Hex 模式下保存为十六进制内容 |

> 文本区只保留最近 "文本区保留行数" 的内容，需要完整留存长时间输出时，请及时导出或使用 [会话录制](SESSION_RECORD_GUIDE.md)。

### 颜色标记

除 ANSI 颜色码外，还可以在输出文本中使用自定义颜色标记。入口：**更多 → 配置 → 颜色设置**，打开 "RTT 颜色标记设置"：

| 设置项 | 默认值 | 说明 |
| ------ | ------ | ---- |
| 启用颜色解析 | 开启 | 关闭后标记原样显示，ANSI 颜色码仍然生效 |
| 标记前缀 / 标记后缀 | `[` / `]` | 标记两侧的字符，最多 2 个字符，如改成 `{{` / `}}` |
| 关闭标记 | `/` | 结束标记中紧跟前缀的字符，最多 2 个字符 |
| 自定义标记 | 见下文 | 每个标记由 "标记名" 和 "颜色" 组成，可 "添加标记" 或删除 |

前缀、后缀或关闭标记留空时按默认值处理。对话框中的 "示例语法" 会按当前设置拼出写法，并实时预览着色效果，保存前即可确认。

内置标记包括颜色 `red`、`green`、`blue`、`yellow`、`cyan`、`magenta`、`white`、`gray`、`black`，背景色 `bg-red`、`bg-green`、`bg-blue`、`bg-yellow`，样式 `bold`、`italic`、`underline`，以及语义标记 `error`、`warn`、`info`、`success`、`debug`。修改后点击 "保存" 生效，"恢复默认" 可还原内置标记。颜色标记设置由 RTT、串口和 BLE 共用，保存后三处立即生效。

用法：在开始标记和结束标记之间的文字按该标记着色。结束标记有两种写法：

- `[/]`：关闭最近打开的一个标记
- `[/red]`：关闭最近一个 `red` 标记；在它之后打开、尚未关闭的标记一并关闭

```c
SEGGER_RTT_printf(0, "[red]错误信息[/] 已重试 %d 次\r\n", retry);
SEGGER_RTT_printf(0, "[success]自检通过[/success]\r\n");
SEGGER_RTT_printf(0, "[bold]电机 [bg-red]过流[/] 已停机[/bold]\r\n");
```

标记可以嵌套，内层继承外层样式。标记名可以包含字母、数字、连字符等字符，区分大小写；只有已配置的标记名才会被识别，`[INFO]`、`[12]` 这类普通方括号文本照常显示。一行内没有关闭的标记作用到行尾；与 ANSI 颜色码混用时，标记在下一个 ANSI 转义处结束，建议在同一段 ANSI 颜色内成对书写。

---

## 接收分帧

RTT 收到的是连续字节流，**更多 → 接收分帧** 决定如何把它切成文本行。每个上行通道各自分帧，互不拼接。

| 选项 | 说明 |
| ---- | ---- |
| 换行（自动 \n / \r\n） | 默认。按 `\n` 断行，并去掉行尾的 `\r` |
| 换行 LF（\n） | 只按 `\n` 断行 |
| 换行 CRLF（\r\n） | 只按 `\r\n` 断行 |
| 换行 CR（\r） | 只按 `\r` 断行 |
| 空闲超时分帧 | 数据停顿超过设定时间（默认 50 ms，最小 5 ms）即断成一帧，适合二进制或定长包 |
| 自定义分隔符 | 按输入的分隔字符断行；点亮右侧 "HEX" 后按十六进制字节解析，如 `0D 0A` |

RTT 通常是 printf 输出，保持 "换行" 即可。按换行分帧时，末尾没有换行符的残余数据会在停顿约 200 ms 后作为一行显示。接收文本按 UTF-8 解码，固件中的中文字符串请以 UTF-8 编码保存。

---

## 向目标发送数据

固件配置了下行通道（`SEGGER_RTT_MAX_NUM_DOWN_BUFFERS` 大于 0，内置的 `SEGGER_RTT_Conf.h` 默认为 3）时，RTT 运行后文本区下方会出现发送栏。"图表" 视图下不显示发送栏，切到 "文本" 或 "分屏" 即可使用。

- 输入内容后按 Enter 或点击 "发送"，上下方向键切换发送历史
- 有多个下行通道时，发送栏左侧会出现通道选择（显示为 `下行 通道号: 名称`）；只有一个下行通道时直接发送到该通道
- 发送的内容以蓝色 `[→通道号]` 显示在文本区；HEX 模式下显示为 `HEX(字节数B): 内容`
- 重新附加期间暂时不能发送，输入框会提示 "正在重新附加，稍后可发送"

点击发送栏左侧的 **发送选项** 可以设置：

| 选项 | 默认值 | 说明 |
| ---- | ------ | ---- |
| HEX 模式 | 关闭 | 开启后按十六进制字节发送，如 `48 65 6C 6C 6F`；此时编码和换行符不可用 |
| 编码 | UTF-8 | 可选 UTF-8 / ASCII / GBK |
| 换行符 | LF (\n) | 可选 无 / LF (\n) / CRLF (\r\n) / CR (\r)，自动追加在发送内容末尾 |
| 发送历史 | — | 点击历史项填入输入框，右上角垃圾桶图标清空历史 |

发送设置会自动保存。

固件侧读取示例：

```c
// 在主循环里轮询下行通道 0，读到的就是上位机发送栏发出的内容
char cmd[32];
unsigned len = SEGGER_RTT_Read(0, cmd, sizeof(cmd) - 1);
if (len > 0) {
    cmd[len] = '\0';
    // 处理命令，例如 if (strncmp(cmd, "led on", 6) == 0) { ... }
}
```

注意：

- 下行缓冲区默认只有 16 字节（`BUFFER_SIZE_DOWN`），一次发送较长内容时请调大，并保证固件及时读取。放不下的部分会在后续轮询中继续写入
- 目标长时间不读取下行缓冲区时，待发送数据累积到 64 KB 后会提示 "下行发送队列已满"
- 固件没有下行通道时发送栏不会出现

---

## 更多菜单一览

| 分组 | 功能 | 说明 |
| ---- | ---- | ---- |
| 工作流 | 智能启用 | 根据最近收到的数据自动识别格式并配置图表，见 [RTT 图表与波形](RTT_CHART_GUIDE.md) |
| 工作流 | 录制会话 / 回放会话 | 录制原始字节流并在之后回放，见 [会话录制与回放](SESSION_RECORD_GUIDE.md) |
| 工作流 | AI | AI 数据桥接，见 [AI 数据桥接](AI_TUNING_GUIDE.md) |
| 工作流 | 波形 / FFT | 打开时域波形或 FFT 频谱，再次点击收起 |
| 工作流 | 上下分屏 / 左右分屏 | 仅分屏视图下显示 |
| 查看 | 自动滚动、文本 / Hex | 见 [文本区](#文本区) |
| 接收分帧 | 分帧方式 | 见 [接收分帧](#接收分帧) |
| 触发捕获 | 开关及设置 | 见 [触发捕获](TRIGGER_CAPTURE_GUIDE.md) |
| 配置 | 图表配置 | 打开 "RTT 图表配置"，见 [RTT 图表与波形](RTT_CHART_GUIDE.md) |
| 配置 | 颜色设置 | 见 [颜色标记](#颜色标记) |
| 输出 | 复制全部、导出 TXT、导出 CSV | 见 [复制与导出](#复制与导出) |

---

## 快捷键

| 快捷键 | 作用 |
| ------ | ---- |
| `Ctrl+2` | 切换到 RTT 工作台 |
| `Ctrl+F` | 聚焦 "搜索 RTT..." 搜索框 |
| `Ctrl+L` | 清空文本区（焦点不在输入框时） |
| `Ctrl+A` / `Ctrl+C` | 在文本区内全选 / 复制选中的行 |
| `Space` | 冻结 / 恢复图表（焦点不在输入框时） |
| `Enter` / `↑` / `↓` | 在发送栏中发送 / 切换发送历史 |

---

## 文件说明

| 文件                  | 说明                                      |
| --------------------- | ----------------------------------------- |
| `SEGGER_RTT.c`        | RTT 核心实现，包含缓冲区管理和读写函数    |
| `SEGGER_RTT.h`        | RTT API 声明，以及 `RTT_CTRL_*` 颜色宏    |
| `SEGGER_RTT_Conf.h`   | 配置文件，可修改缓冲区大小、通道数量等    |
| `SEGGER_RTT_printf.c` | 实现 `SEGGER_RTT_printf()` 格式化输出函数 |

---

## 集成步骤

### 基本配置

默认配置适用于大多数场景。如需自定义，修改 `SEGGER_RTT_Conf.h`。内置文件的默认值如下：

```c
// 上行缓冲区大小（目标 -> 主机），默认 1024 字节
// 输出量大、数据丢失时可以增大，例如改为 4096
#define BUFFER_SIZE_UP    (1024)

// 下行缓冲区大小（主机 -> 目标），默认 16 字节
#define BUFFER_SIZE_DOWN  (16)

// 最大上行通道数，默认 3
#define SEGGER_RTT_MAX_NUM_UP_BUFFERS    (3)

// 最大下行通道数，默认 3
#define SEGGER_RTT_MAX_NUM_DOWN_BUFFERS  (3)

// SEGGER_RTT_printf 的内部缓冲区，默认 64 字节
#define SEGGER_RTT_PRINTF_BUFFER_SIZE    (64u)
```

### 缓冲区模式

RTT 支持三种缓冲区模式，通道 0 默认使用 "跳过" 模式（`SEGGER_RTT_MODE_DEFAULT`），**强烈建议保持非阻塞模式**：

```c
// 模式 0: 跳过 - 缓冲区放不下时整条丢弃（默认，推荐）
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);

// 模式 1: 截断 - 缓冲区放不下时只写入能放下的部分
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_TRIM);

// 模式 2: 阻塞 - 缓冲区满时阻塞等待（不推荐，上位机未读取时程序会卡住）
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_BLOCK_IF_FIFO_FULL);
```

---

## API 参考

### 初始化

```c
void SEGGER_RTT_Init(void);
```

初始化 RTT 控制块。首次调用任意 RTT 输出函数时也会自动初始化，但建议在 `main()` 开头尽早显式调用：控制块初始化之后上位机才能找到它。

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

支持的格式符：`%c`、`%d`、`%u`、`%x`、`%X`、`%s`、`%p`、`%%`，以及 `-`、`0`、`+`、`#` 标志和宽度。

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

输出二进制数据。上位机查看时可切换到 Hex 显示，或在图表配置中选用字节流解析模式（如 JustFloat）。

**示例：**

```c
uint8_t data[] = {0x01, 0x02, 0x03, 0x04};
SEGGER_RTT_Write(0, data, sizeof(data));
```

### 读取下行数据

```c
unsigned SEGGER_RTT_Read(unsigned BufferIndex, void *pBuffer, unsigned BufferSize);
```

从下行通道读取上位机发送的数据，返回读到的字节数，没有数据时返回 0。用法见 [向目标发送数据](#向目标发送数据)。

### 配置通道

```c
int SEGGER_RTT_ConfigUpBuffer(unsigned BufferIndex, const char *sName,
                               void *pBuffer, unsigned BufferSize, unsigned Flags);
```

配置上行通道（目标 -> 主机）。

**参数：**

- `BufferIndex` - 通道索引
- `sName` - 通道名称（可为 NULL），会显示在上位机的通道列表中
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

RTT 文本区支持 ANSI 转义序列，可以输出彩色文本。只支持颜色和粗体相关的 `ESC[...m` 序列，清屏、光标移动等控制序列不生效。

### 颜色代码

| 代码       | 颜色 | 代码       | 颜色     |
| ---------- | ---- | ---------- | -------- |
| `\x1b[30m` | 黑色 | `\x1b[90m` | 亮黑（灰） |
| `\x1b[31m` | 红色 | `\x1b[91m` | 亮红     |
| `\x1b[32m` | 绿色 | `\x1b[92m` | 亮绿     |
| `\x1b[33m` | 黄色 | `\x1b[93m` | 亮黄     |
| `\x1b[34m` | 蓝色 | `\x1b[94m` | 亮蓝     |
| `\x1b[35m` | 紫色 | `\x1b[95m` | 亮紫     |
| `\x1b[36m` | 青色 | `\x1b[96m` | 亮青     |
| `\x1b[37m` | 白色 | `\x1b[97m` | 亮白     |
| `\x1b[0m`  | 重置 |            |          |

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

多个代码可以用分号组合，例如 `\x1b[44;37m` 表示蓝底白字。

### 使用示例

`SEGGER_RTT.h` 已经定义了一组颜色宏（`RTT_CTRL_RESET`、`RTT_CTRL_TEXT_BRIGHT_RED`、`RTT_CTRL_BG_BLUE` 等），可以直接使用，不要再自行定义同名宏：

```c
// 使用 SEGGER_RTT.h 自带的颜色宏
SEGGER_RTT_printf(0, RTT_CTRL_TEXT_BRIGHT_RED "[ERROR] " RTT_CTRL_RESET "发生错误!\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_TEXT_BRIGHT_GREEN "[OK] " RTT_CTRL_RESET "操作成功\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_TEXT_BRIGHT_YELLOW "[WARN] " RTT_CTRL_RESET "警告信息\r\n");
SEGGER_RTT_printf(0, RTT_CTRL_TEXT_BRIGHT_BLUE "[INFO] " RTT_CTRL_RESET "普通信息\r\n");

// 也可以直接写转义序列
SEGGER_RTT_printf(0, "\x1b[1;31m严重错误!\x1b[0m\r\n");

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

> 不使用 ANSI 颜色码时，行内带有 `[ERROR]`、`[WARN]`、`[DEBUG]` 等关键字也会按级别着色，见 [日志级别着色](#日志级别着色)。

---

## 常见问题

### 1. 启动后找不到控制块 / 启动失败

**常见提示：** "未找到 RTT 控制块（…）"

**可能原因：** 控制块尚未初始化、不在扫描范围内，或 RAM 太大扫描很慢

**解决方法：**

1. 确认目标正在运行（不是停在复位或断点处），且已执行过 `SEGGER_RTT_Init()` 或第一次 RTT 输出
2. 点击 "启动" 右侧的查找方式按钮，改用 "ELF 符号" 并选择固件 ELF / AXF 文件
3. 或改用 "指定地址"，填写 .map 文件中 `_SEGGER_RTT` 的地址
4. RAM 中同时存在多个控制块（例如 Bootloader 和 App 各一个）时，自动扫描会优先选择有待读数据的那个，见 [Bootloader 与 App 切换](#bootloader-与-app-切换)
5. 自动扫描时间较长时，可以点 "取消启动" 中止，改用上面的方式

### 2. "启动" 按钮是灰色的

既没有独立 RTT 连接，也没有烧录连接。先点击 "连接 RTT"，或在烧录工作台连接设备。连接 RTT 前需要在右侧配置检查器选择调试探针并填写目标芯片型号。

### 3. 提示 "访问目标内存失败"

检查探针接线、目标供电，以及配置检查器中的时钟速度（可适当调低）。

### 4. 启动成功但没有数据显示

**可能原因：**

- 目标芯片没有运行，或程序没有执行到 RTT 输出的代码
- 状态栏 "通道" 选成了没有输出的通道，或搜索框里还留有关键字
- 处于 "暂停显示" 状态
- 输出没有换行符，且接收分帧选成了其他断行方式

**解决方法：**

1. 确保目标芯片复位后正常运行
2. 状态栏通道选择 "全部"，清空搜索框
3. 检查 "暂停显示" 按钮是否显示为 "继续"
4. 检查 **更多 → 接收分帧** 是否为 "换行（自动 \n / \r\n）"

### 5. 数据丢失

**原因：** 缓冲区太小，数据产生速度超过读取速度。默认的 "跳过" 模式下放不下的整条输出会被丢弃

**解决方法：**

1. 增大缓冲区（修改 `SEGGER_RTT_Conf.h`）
   ```c
   #define BUFFER_SIZE_UP    (4096)  // 增大到 4KB
   ```
2. 在启动设置中减小 "轮询间隔"
3. 减少打印频率和单次打印的数据量

### 6. 目标程序卡住

**原因：** 上行通道被配置成了阻塞模式，上位机没有及时读取时目标会等待

**解决方法：** 配置为非阻塞模式

```c
SEGGER_RTT_ConfigUpBuffer(0, NULL, NULL, 0, SEGGER_RTT_MODE_NO_BLOCK_SKIP);
```

### 7. 输出内容错乱

先确认缓冲区没有溢出、多个任务没有同时写同一通道。仍然错乱时，可在启动设置中开启 "读取时暂停目标"，代价是每次读取都会短暂暂停 CPU。

### 8. 中文乱码

接收文本按 UTF-8 解码。请把固件源文件保存为 UTF-8（含 BOM 也可以），避免使用 GB2312 / GBK 编码的字符串。

### 9. 发送提示 "下行发送队列已满"

固件没有及时读取下行缓冲区。请在主循环中调用 `SEGGER_RTT_Read()` 或 `SEGGER_RTT_GetKey()`，必要时增大 `BUFFER_SIZE_DOWN`。

### 10. 浮点数无法打印

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
    static uint32_t total_count = 0;

    total_count++;
    // 每 1000 次才打印一次
    if (++count >= 1000) {
        count = 0;
        SEGGER_RTT_printf(0, "定时器中断计数: %u\r\n", total_count);
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

在上位机状态栏的 "通道" 中选择 `0: Log`、`1: Data` 等即可只看某一路输出。图表解析会处理所有通道的数据；只想绘制某一路时，可以给数值输出加一个固定前缀，并在图表配置中填写 "数据帧前缀"，见 [RTT 图表与波形](RTT_CHART_GUIDE.md)。

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

- [RTT 图表与波形](RTT_CHART_GUIDE.md)、[RTT XY 散点图](RTT_XY_SCATTER_GUIDE.md)
- [触发捕获](TRIGGER_CAPTURE_GUIDE.md)、[会话录制与回放](SESSION_RECORD_GUIDE.md)
- [SEGGER RTT 官方文档](https://www.segger.com/products/debug-probes/j-link/technology/about-real-time-transfer/)
- [probe-rs 文档](https://probe.rs/)
- [MICU-OmniProbe 项目主页](https://github.com/zuoliangyu/MICU-OmniProbe)
