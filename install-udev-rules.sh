#!/bin/bash
# MICU-OmniProbe - udev 规则安装脚本

set -e

RULES_FILE="99-zuolan-daplink.rules"
INSTALL_PATH="/etc/udev/rules.d/$RULES_FILE"

echo "=========================================="
echo "MICU-OmniProbe - udev 规则安装"
echo "=========================================="
echo ""

# 检查是否以 root 权限运行
if [ "$EUID" -ne 0 ]; then
    echo "错误: 请使用 sudo 运行此脚本"
    echo "用法: sudo ./install-udev-rules.sh"
    exit 1
fi

# 检查规则文件是否存在
if [ ! -f "$RULES_FILE" ]; then
    echo "错误: 找不到规则文件 $RULES_FILE"
    echo "请确保在项目根目录运行此脚本"
    exit 1
fi

# 复制规则文件
echo "正在安装 udev 规则..."
cp "$RULES_FILE" "$INSTALL_PATH"
chmod 644 "$INSTALL_PATH"
echo "✓ 规则文件已安装到: $INSTALL_PATH"

# 重新加载 udev 规则
echo ""
echo "正在重新加载 udev 规则..."
udevadm control --reload-rules
udevadm trigger
echo "✓ udev 规则已重新加载"

# 检查 plugdev 组
echo ""
if getent group plugdev > /dev/null 2>&1; then
    echo "✓ plugdev 组已存在"

    # 提示用户将自己添加到 plugdev 组
    if [ -n "$SUDO_USER" ]; then
        if groups "$SUDO_USER" | grep -q plugdev; then
            echo "✓ 用户 $SUDO_USER 已在 plugdev 组中"
        else
            echo ""
            echo "建议: 将用户添加到 plugdev 组以获得更好的权限管理"
            echo "运行: sudo usermod -a -G plugdev $SUDO_USER"
            echo "然后注销并重新登录"
        fi
    fi
else
    echo "⚠ plugdev 组不存在（某些发行版可能不需要）"
fi

echo ""
echo "=========================================="
echo "安装完成！"
echo "=========================================="
echo ""
echo "请重新插拔调试器，或重启系统以使规则生效"
echo ""
