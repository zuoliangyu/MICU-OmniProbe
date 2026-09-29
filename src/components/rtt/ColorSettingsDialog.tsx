import { useState } from "react";
import { useRttStore } from "@/stores/rttStore";
import { DEFAULT_PARSER_CONFIG, type ColorTag } from "@/lib/rttColorParser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings2, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

interface ColorSettingsDialogProps {
  trigger?: ReactNode;
  title?: string;
  description?: string;
}

export function ColorSettingsDialog({
  trigger,
  title = "RTT 颜色标记设置",
  description = "自定义颜色标记语法，让 RTT 输出更易读。例如：[red]错误信息[/]",
}: ColorSettingsDialogProps) {
  const { colorParserConfig, setColorParserConfig } = useRttStore(
    useShallow((state) => ({
      colorParserConfig: state.colorParserConfig,
      setColorParserConfig: state.setColorParserConfig,
    }))
  );
  const [open, setOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState(colorParserConfig);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setLocalConfig(colorParserConfig);
    }
    setOpen(nextOpen);
  };

  const handleSave = () => {
    setColorParserConfig(localConfig);
    setOpen(false);
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_PARSER_CONFIG);
  };

  const addTag = () => {
    setLocalConfig({
      ...localConfig,
      tags: [...localConfig.tags, { name: "new-tag", color: "#ffffff" }],
    });
  };

  const removeTag = (index: number) => {
    setLocalConfig({
      ...localConfig,
      tags: localConfig.tags.filter((_, i) => i !== index),
    });
  };

  const updateTag = (index: number, updates: Partial<ColorTag>) => {
    setLocalConfig({
      ...localConfig,
      tags: localConfig.tags.map((tag, i) => (i === index ? { ...tag, ...updates } : tag)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" title="颜色设置">
            <Settings2 className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto p-7">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">启用颜色解析</Label>
            <Switch
              id="enabled"
              checked={localConfig.enabled}
              onCheckedChange={(enabled) => setLocalConfig({ ...localConfig, enabled })}
            />
          </div>

          {/* 标记语法配置 */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="prefix">标记前缀</Label>
              <Input
                id="prefix"
                value={localConfig.tagPrefix}
                onChange={(e) => setLocalConfig({ ...localConfig, tagPrefix: e.target.value })}
                placeholder="["
                maxLength={2}
              />
            </div>
            <div>
              <Label htmlFor="suffix">标记后缀</Label>
              <Input
                id="suffix"
                value={localConfig.tagSuffix}
                onChange={(e) => setLocalConfig({ ...localConfig, tagSuffix: e.target.value })}
                placeholder="]"
                maxLength={2}
              />
            </div>
            <div>
              <Label htmlFor="closeTag">关闭标记</Label>
              <Input
                id="closeTag"
                value={localConfig.closeTag}
                onChange={(e) => setLocalConfig({ ...localConfig, closeTag: e.target.value })}
                placeholder="/"
                maxLength={1}
              />
            </div>
          </div>

          {/* 示例 */}
          <div className="glass-section rounded-2xl p-3 text-sm">
            <div className="font-medium mb-1">示例语法：</div>
            <code>
              {localConfig.tagPrefix}red{localConfig.tagSuffix}错误信息
              {localConfig.tagPrefix}
              {localConfig.closeTag}
              {localConfig.tagSuffix}
            </code>
          </div>

          {/* 标记列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>自定义标记</Label>
              <Button variant="outline" size="sm" onClick={addTag}>
                <Plus className="h-3 w-3 mr-1" />
                添加标记
              </Button>
            </div>

            <div className="glass-section rounded-2xl p-2 h-[300px] overflow-y-auto">
              <div className="space-y-2">
                {localConfig.tags.map((tag, index) => (
                  <div
                    key={index}
                    className="glass-section rounded-2xl grid grid-cols-[1fr,1fr,auto] gap-2 items-center p-2"
                  >
                    <div>
                      <Label className="text-xs">标记名</Label>
                      <Input
                        value={tag.name}
                        onChange={(e) => updateTag(index, { name: e.target.value })}
                        placeholder="red"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">颜色</Label>
                      <div className="flex gap-1">
                        <Input
                          type="color"
                          value={tag.color || "#ffffff"}
                          onChange={(e) => updateTag(index, { color: e.target.value })}
                          className="h-8 w-16"
                        />
                        <Input
                          value={tag.color || ""}
                          onChange={(e) => updateTag(index, { color: e.target.value })}
                          placeholder="#ffffff"
                          className="h-8 flex-1"
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTag(index)}
                      className="h-8 w-8"
                      aria-label="删除标签"
                      title="删除标签"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={handleReset}>
              恢复默认
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSave}>保存</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
