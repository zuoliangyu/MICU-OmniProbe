import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Binary, CheckCircle2, Download, Plus, Save, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportJson } from "@/lib/exporters";
import type { ChartSample } from "@/lib/chartAnalysis";
import { loadBinaryProtocolLibrary, saveBinaryProtocolLibrary } from "@/lib/binaryProtocolLibrary";
import {
  BINARY_CHECKSUM_PRESETS,
  BINARY_FIELD_TYPES,
  BinaryProtocolStream,
  checksumByteWidth,
  fieldByteWidth,
  formatHexBytes,
  parseHexBytes,
  sanitizeBinaryProtocolConfig,
  validateBinaryProtocolConfig,
  type BinaryByteOrder,
  type BinaryFieldConfig,
  type BinaryFieldType,
  type BinaryFrameMode,
  type BinaryMessageConfig,
  type BinaryProtocolConfig,
} from "@/lib/binaryProtocol";

export interface BinaryProtocolDesignerProps {
  value: BinaryProtocolConfig;
  onChange: (value: BinaryProtocolConfig) => void;
  onLibraryChange?: (protocols: BinaryProtocolConfig[]) => void;
  samples?: ChartSample[];
}

interface BinaryProtocolDesignerDialogProps extends BinaryProtocolDesignerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELD_TYPE_LABELS: Record<BinaryFieldType, string> = {
  uint8: "uint8",
  int8: "int8",
  uint16: "uint16",
  int16: "int16",
  uint24: "uint24",
  int24: "int24",
  uint32: "uint32",
  int32: "int32",
  uint64: "uint64",
  int64: "int64",
  float32: "float32",
  float64: "float64",
  bcd8: "BCD 8-bit",
  bcd16: "BCD 16-bit",
  bcd32: "BCD 32-bit",
  bitfield: "位域",
};

/**
 * 协议设计器对话框本体。外层每次打开都会换 key 重新挂载，
 * 所以草稿、样本和协议库都在初始 state 里从当前值取一次即可。
 */
export default function BinaryProtocolDesignerDialog({
  value,
  onChange,
  onLibraryChange,
  samples = [],
  open,
  onOpenChange: setOpen,
}: BinaryProtocolDesignerDialogProps) {
  const [draft, setDraft] = useState(() => sanitizeBinaryProtocolConfig(value));
  const [selectedMessageId, setSelectedMessageId] = useState(draft.messages[0]?.id ?? "");
  const [sampleHex, setSampleHex] = useState(() => {
    const latestBytes = [...samples].reverse().find(({ rawData }) => rawData?.length)?.rawData;
    return latestBytes ? formatHexBytes(latestBytes) : "";
  });
  const [status, setStatus] = useState("");
  const [savedProtocols, setSavedProtocols] = useState<BinaryProtocolConfig[]>(loadBinaryProtocolLibrary);
  const [selectedProtocolName, setSelectedProtocolName] = useState(() =>
    savedProtocols.some(({ name }) => name === draft.name) ? draft.name : ""
  );

  const selectedMessageIndex = Math.max(
    0,
    draft.messages.findIndex((message) => message.id === selectedMessageId)
  );
  const selectedMessage = draft.messages[selectedMessageIndex];
  const errors = useMemo(() => validateBinaryProtocolConfig(draft), [draft]);
  const previewBytes = useMemo(() => parseHexBytes(sampleHex), [sampleHex]);
  const preview = useMemo(() => {
    if (!previewBytes?.length || errors.length > 0) return undefined;
    const stream = new BinaryProtocolStream(draft);
    const result = stream.ingest(previewBytes);
    return result.frames[result.frames.length - 1];
  }, [draft, errors.length, previewBytes]);

  const loadSavedProtocol = (name: string) => {
    const next = savedProtocols.find((protocol) => protocol.name === name);
    if (!next) return;
    const protocol = sanitizeBinaryProtocolConfig(next);
    setDraft(protocol);
    setSelectedMessageId(protocol.messages[0]?.id ?? "");
    setSelectedProtocolName(protocol.name);
    setStatus(`已载入协议：${protocol.name}`);
  };

  const saveProtocol = () => {
    if (errors.length > 0) return;
    const protocol = sanitizeBinaryProtocolConfig(draft);
    const existingIndex = savedProtocols.findIndex(({ name }) => name === protocol.name);
    const protocols =
      existingIndex < 0
        ? [...savedProtocols, protocol]
        : savedProtocols.map((saved, index) => (index === existingIndex ? protocol : saved));
    saveBinaryProtocolLibrary(protocols);
    setDraft(protocol);
    setSavedProtocols(protocols);
    setSelectedProtocolName(protocol.name);
    onLibraryChange?.(protocols);
    setStatus(`${existingIndex < 0 ? "已保存" : "已覆盖"}协议：${protocol.name}`);
  };

  const deleteSavedProtocol = () => {
    if (!selectedProtocolName || !window.confirm(`确定删除已保存协议“${selectedProtocolName}”吗？`)) return;
    const protocols = savedProtocols.filter(({ name }) => name !== selectedProtocolName);
    saveBinaryProtocolLibrary(protocols);
    setSavedProtocols(protocols);
    setSelectedProtocolName("");
    onLibraryChange?.(protocols);
    setStatus(`已删除协议：${selectedProtocolName}`);
  };

  const updateFrame = (patch: Partial<BinaryProtocolConfig["frame"]>) =>
    setDraft((current) => ({ ...current, frame: { ...current.frame, ...patch } }));
  const updateChecksum = (patch: Partial<BinaryProtocolConfig["checksum"]>) =>
    setDraft((current) => ({ ...current, checksum: { ...current.checksum, ...patch } }));
  const updateMessage = (patch: Partial<BinaryMessageConfig>) =>
    setDraft((current) => ({
      ...current,
      messages: current.messages.map((message, index) =>
        index === selectedMessageIndex ? { ...message, ...patch } : message
      ),
    }));
  const updateField = (index: number, patch: Partial<BinaryFieldConfig>) => {
    if (!selectedMessage) return;
    updateMessage({
      fields: selectedMessage.fields.map((field, fieldIndex) =>
        fieldIndex === index ? normalizeFieldPatch(field, patch) : field
      ),
    });
  };

  const addMessage = () => {
    const used = new Set(draft.messages.map(({ id }) => id));
    let number = draft.messages.length + 1;
    while (used.has(`message-${number}`)) number += 1;
    const message: BinaryMessageConfig = {
      id: `message-${number}`,
      name: `消息 ${number}`,
      matchOffset: 2,
      matchBytes: [number & 0xff],
      matchMask: [0xff],
      fields: [newField(1)],
    };
    setDraft((current) => ({ ...current, messages: [...current.messages, message] }));
    setSelectedMessageId(message.id);
  };

  const removeMessage = () => {
    if (draft.messages.length <= 1) return;
    const messages = draft.messages.filter((_, index) => index !== selectedMessageIndex);
    setDraft((current) => ({ ...current, messages }));
    setSelectedMessageId(messages[Math.min(selectedMessageIndex, messages.length - 1)].id);
  };

  const addField = () => {
    if (!selectedMessage) return;
    updateMessage({ fields: [...selectedMessage.fields, newField(selectedMessage.fields.length + 1)] });
  };
  const removeField = (index: number) => {
    if (!selectedMessage) return;
    if (selectedMessage.fields.length <= 1) return;
    updateMessage({ fields: selectedMessage.fields.filter((_, fieldIndex) => fieldIndex !== index) });
  };

  const applyPreset = (presetId: string) => {
    const preset = BINARY_CHECKSUM_PRESETS.find(({ id }) => id === presetId);
    if (!preset) return;
    updateChecksum({
      ...preset.config,
      valueOffset: -checksumByteWidth(preset.config.algorithm),
      dataEnd: -checksumByteWidth(preset.config.algorithm),
    });
  };

  const importProtocol = async () => {
    const path = await openFile({ multiple: false, filters: [{ name: "二进制协议", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const parsed = JSON.parse(await invoke<string>("read_text_file", { path })) as Record<string, unknown>;
      const next = sanitizeBinaryProtocolConfig(parsed.protocol ?? parsed);
      setDraft(next);
      setSelectedMessageId(next.messages[0]?.id ?? "");
      setSelectedProtocolName("");
      setStatus("协议配置已导入");
    } catch (error) {
      setStatus(`导入失败：${String(error)}`);
    }
  };

  const exportProtocol = async () => {
    try {
      await exportJson(
        JSON.stringify({ format: "MICU-OmniProbe binary protocol", version: 1, protocol: draft }, null, 2),
        `${safeFileName(draft.name)}.json`
      );
      setStatus("协议配置已导出");
    } catch (error) {
      setStatus(`导出失败：${String(error)}`);
    }
  };

  const applyProtocol = () => {
    if (errors.length > 0) return;
    onChange(sanitizeBinaryProtocolConfig(draft));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(92vh,900px)] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Binary className="h-4 w-4 text-primary" />
            二进制协议设计器
          </DialogTitle>
          <DialogDescription>配置帧同步、长度、消息类型、字段和校验规则。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2 border-b border-border/60 px-5 py-3">
          <div className="min-w-52 flex-1 space-y-1">
            <Label htmlFor="binary-saved-protocol">已保存协议</Label>
            <div className="flex gap-2">
              <Select
                value={selectedProtocolName || undefined}
                onValueChange={loadSavedProtocol}
                disabled={savedProtocols.length === 0}
              >
                <SelectTrigger id="binary-saved-protocol" className="min-w-0 flex-1">
                  <SelectValue placeholder={savedProtocols.length > 0 ? "选择协议" : "暂无保存协议"} />
                </SelectTrigger>
                <SelectContent>
                  {savedProtocols.map((protocol) => (
                    <SelectItem key={protocol.name} value={protocol.name}>
                      {protocol.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={!selectedProtocolName}
                onClick={deleteSavedProtocol}
                title="删除已保存协议"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">删除已保存协议</span>
              </Button>
            </div>
          </div>
          <div className="min-w-52 flex-1 space-y-1">
            <Label htmlFor="binary-protocol-name">协议名称</Label>
            <Input
              id="binary-protocol-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={errors.length > 0}
              onClick={saveProtocol}
            >
              <Save className="h-3.5 w-3.5" />
              保存协议
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={importProtocol}>
              <Upload className="h-3.5 w-3.5" />
              导入
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={exportProtocol}>
              <Download className="h-3.5 w-3.5" />
              导出
            </Button>
          </div>
        </div>

        <Tabs defaultValue="frame" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 grid w-fit grid-cols-3">
            <TabsTrigger value="frame">帧结构</TabsTrigger>
            <TabsTrigger value="messages">消息字段</TabsTrigger>
            <TabsTrigger value="preview">实时预览</TabsTrigger>
          </TabsList>

          <TabsContent value="frame" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="grid gap-6 pt-2 lg:grid-cols-2">
              <section className="space-y-3">
                <SectionTitle>帧同步与长度</SectionTitle>
                <FormGrid>
                  <Field label="固定帧头（HEX）" wide>
                    <HexBytesInput value={draft.frame.header} onChange={(header) => updateFrame({ header })} />
                  </Field>
                  <Field label="分帧方式">
                    <Select value={draft.frame.mode} onValueChange={(mode: BinaryFrameMode) => updateFrame({ mode })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="length">长度字段</SelectItem>
                        <SelectItem value="fixed">固定长度</SelectItem>
                        <SelectItem value="delimiter">帧尾分隔符</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {draft.frame.mode === "fixed" && (
                    <NumberField
                      label="固定帧长"
                      value={draft.frame.fixedLength}
                      min={1}
                      onChange={(fixedLength) => updateFrame({ fixedLength })}
                    />
                  )}
                  {draft.frame.mode === "delimiter" && (
                    <Field label="帧尾（HEX）">
                      <HexBytesInput
                        value={draft.frame.delimiter}
                        onChange={(delimiter) => updateFrame({ delimiter })}
                      />
                    </Field>
                  )}
                  {draft.frame.mode === "length" && (
                    <>
                      <NumberField
                        label="长度字段偏移"
                        value={draft.frame.lengthField.offset}
                        min={0}
                        onChange={(offset) => updateFrame({ lengthField: { ...draft.frame.lengthField, offset } })}
                      />
                      <Field label="长度字段宽度">
                        <Select
                          value={String(draft.frame.lengthField.width)}
                          onValueChange={(width) =>
                            updateFrame({
                              lengthField: { ...draft.frame.lengthField, width: Number(width) as 1 | 2 | 4 },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 字节</SelectItem>
                            <SelectItem value="2">2 字节</SelectItem>
                            <SelectItem value="4">4 字节</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <ByteOrderField
                        value={draft.frame.lengthField.byteOrder}
                        onChange={(byteOrder) =>
                          updateFrame({ lengthField: { ...draft.frame.lengthField, byteOrder } })
                        }
                      />
                      <NumberField
                        label="长度倍数"
                        value={draft.frame.lengthField.multiplier}
                        step="any"
                        onChange={(multiplier) =>
                          updateFrame({ lengthField: { ...draft.frame.lengthField, multiplier } })
                        }
                      />
                      <NumberField
                        label="长度修正"
                        value={draft.frame.lengthField.adjustment}
                        onChange={(adjustment) =>
                          updateFrame({ lengthField: { ...draft.frame.lengthField, adjustment } })
                        }
                      />
                    </>
                  )}
                  <NumberField
                    label="Payload 起始偏移"
                    value={draft.frame.payloadOffset}
                    min={0}
                    onChange={(payloadOffset) => updateFrame({ payloadOffset })}
                  />
                  <NumberField
                    label="最大帧长"
                    value={draft.frame.maxLength}
                    min={1}
                    max={1024 * 1024}
                    onChange={(maxLength) => updateFrame({ maxLength })}
                  />
                </FormGrid>
                {draft.frame.mode === "length" && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    总帧长 = 长度字段值 × {draft.frame.lengthField.multiplier} + {draft.frame.lengthField.adjustment}
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <SectionTitle>CRC / 校验和</SectionTitle>
                <FormGrid>
                  <Field label="算法预设" wide>
                    <Select value={findPresetId(draft)} onValueChange={applyPreset}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BINARY_CHECKSUM_PRESETS.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">自定义参数</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {draft.checksum.algorithm !== "none" && (
                    <>
                      <NumberField
                        label="校验值偏移"
                        value={draft.checksum.valueOffset}
                        onChange={(valueOffset) => updateChecksum({ valueOffset })}
                      />
                      <ByteOrderField
                        value={draft.checksum.byteOrder}
                        onChange={(byteOrder) => updateChecksum({ byteOrder })}
                      />
                      <NumberField
                        label="覆盖起点（包含）"
                        value={draft.checksum.dataStart}
                        onChange={(dataStart) => updateChecksum({ dataStart })}
                      />
                      <NumberField
                        label="覆盖终点（不包含）"
                        value={draft.checksum.dataEnd}
                        onChange={(dataEnd) => updateChecksum({ dataEnd })}
                      />
                      {draft.checksum.algorithm.startsWith("crc") && (
                        <>
                          <HexNumberField
                            label="多项式"
                            value={draft.checksum.polynomial}
                            onChange={(polynomial) => updateChecksum({ polynomial })}
                          />
                          <HexNumberField
                            label="初值"
                            value={draft.checksum.initial}
                            onChange={(initial) => updateChecksum({ initial })}
                          />
                          <HexNumberField
                            label="结果异或"
                            value={draft.checksum.xorOut}
                            onChange={(xorOut) => updateChecksum({ xorOut })}
                          />
                          <ToggleField
                            label="输入反射"
                            checked={draft.checksum.reflectIn}
                            onChange={(reflectIn) => updateChecksum({ reflectIn })}
                          />
                          <ToggleField
                            label="输出反射"
                            checked={draft.checksum.reflectOut}
                            onChange={(reflectOut) => updateChecksum({ reflectOut })}
                          />
                        </>
                      )}
                    </>
                  )}
                </FormGrid>
                <p className="text-xs leading-5 text-muted-foreground">
                  负偏移从帧尾计算，例如 CRC16 位于最后两字节时填写 -2。
                </p>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="messages" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="space-y-1 pt-2 text-xs leading-5 text-muted-foreground">
              <p>
                同一协议可以包含多种消息类型，例如状态帧、测量帧和告警帧。系统先按匹配规则选择消息，再按该消息的字段布局解析。
              </p>
              <p>设备只有一种帧时保留“默认消息”即可；默认消息只在没有具体消息匹配时使用。</p>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1 space-y-1">
                <Label>当前消息类型</Label>
                <Select value={selectedMessage?.id} onValueChange={setSelectedMessageId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {draft.messages.map((message) => (
                      <SelectItem key={message.id} value={message.id}>
                        {message.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addMessage} title="添加消息">
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={draft.messages.length <= 1}
                onClick={removeMessage}
                title="删除消息"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {selectedMessage && (
              <>
                <FormGrid className="mt-4">
                  <Field label="消息 ID">
                    <Input
                      value={selectedMessage.id}
                      onChange={(event) => {
                        const id = event.target.value;
                        updateMessage({ id });
                        setSelectedMessageId(id);
                      }}
                    />
                  </Field>
                  <Field label="显示名称">
                    <Input
                      value={selectedMessage.name}
                      onChange={(event) => updateMessage({ name: event.target.value })}
                    />
                  </Field>
                  <NumberField
                    label="匹配偏移"
                    value={selectedMessage.matchOffset}
                    min={0}
                    onChange={(matchOffset) => updateMessage({ matchOffset })}
                  />
                  <Field label="匹配字节（HEX）">
                    <HexBytesInput
                      value={selectedMessage.matchBytes}
                      onChange={(matchBytes) =>
                        updateMessage({
                          matchBytes,
                          matchMask: matchBytes.map((_, index) => selectedMessage.matchMask[index] ?? 0xff),
                        })
                      }
                    />
                  </Field>
                  <Field label="匹配掩码（HEX）">
                    <HexBytesInput
                      value={selectedMessage.matchMask}
                      onChange={(matchMask) => updateMessage({ matchMask })}
                    />
                  </Field>
                </FormGrid>
                <p className="mt-2 text-xs text-muted-foreground">
                  匹配字节留空即为默认消息；掩码 FF 表示完全匹配，00 表示忽略该字节。
                </p>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <SectionTitle>字段</SectionTitle>
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addField}>
                    <Plus className="h-3.5 w-3.5" />
                    添加字段
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {selectedMessage.fields.map((field, index) => (
                    <div key={`${field.key}-${index}`} className="rounded-lg border border-border/60 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">字段 {index + 1}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={selectedMessage.fields.length <= 1}
                          onClick={() => removeField(index)}
                          title="删除字段"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <FormGrid>
                        <Field label="key">
                          <Input
                            value={field.key}
                            onChange={(event) => updateField(index, { key: event.target.value })}
                          />
                        </Field>
                        <Field label="名称">
                          <Input
                            value={field.name}
                            onChange={(event) => updateField(index, { name: event.target.value })}
                          />
                        </Field>
                        <Field label="数据类型">
                          <Select
                            value={field.type}
                            onValueChange={(type: BinaryFieldType) =>
                              updateField(index, {
                                type,
                                stride: fieldByteWidth({
                                  type,
                                  bitOffset: field.bitOffset,
                                  bitLength: field.bitLength,
                                }),
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {BINARY_FIELD_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {FIELD_TYPE_LABELS[type]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="偏移基准">
                          <Select
                            value={field.offsetBase}
                            onValueChange={(offsetBase: "frame" | "payload") => updateField(index, { offsetBase })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="frame">帧起点</SelectItem>
                              <SelectItem value="payload">Payload 起点</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <NumberField
                          label="字节偏移"
                          value={field.offset}
                          min={0}
                          onChange={(offset) => updateField(index, { offset })}
                        />
                        <ByteOrderField
                          value={field.byteOrder}
                          onChange={(byteOrder) => updateField(index, { byteOrder })}
                        />
                        <NumberField
                          label="数量"
                          value={field.count}
                          min={1}
                          max={1024}
                          onChange={(count) => updateField(index, { count })}
                        />
                        <NumberField
                          label="步长"
                          value={field.stride}
                          min={0}
                          onChange={(stride) => updateField(index, { stride })}
                        />
                        <NumberField
                          label="比例"
                          value={field.scale}
                          step="any"
                          onChange={(scale) => updateField(index, { scale })}
                        />
                        <NumberField
                          label="偏移值"
                          value={field.bias}
                          step="any"
                          onChange={(bias) => updateField(index, { bias })}
                        />
                        <Field label="单位">
                          <Input
                            value={field.unit ?? ""}
                            onChange={(event) => updateField(index, { unit: event.target.value || undefined })}
                          />
                        </Field>
                        {field.type === "bitfield" && (
                          <>
                            <NumberField
                              label="位偏移（LSB）"
                              value={field.bitOffset}
                              min={0}
                              max={63}
                              onChange={(bitOffset) => updateField(index, { bitOffset })}
                            />
                            <NumberField
                              label="位宽"
                              value={field.bitLength}
                              min={1}
                              max={64}
                              onChange={(bitLength) => updateField(index, { bitLength })}
                            />
                          </>
                        )}
                      </FormGrid>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="grid gap-5 pt-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
              <section className="space-y-3">
                <SectionTitle>HEX 样本</SectionTitle>
                <textarea
                  value={sampleHex}
                  onChange={(event) => setSampleHex(event.target.value)}
                  rows={8}
                  placeholder="55 AA 01 02 34 12 ..."
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-6 outline-none focus:ring-2 focus:ring-ring"
                />
                {previewBytes && previewBytes.length > 0 && <BytePreview bytes={previewBytes} preview={preview} />}
              </section>
              <section className="space-y-3">
                <SectionTitle>解析结果</SectionTitle>
                {errors.length > 0 ? (
                  <StatusBlock ok={false} lines={errors} />
                ) : previewBytes === null ? (
                  <StatusBlock ok={false} lines={["HEX 样本格式无效"]} />
                ) : preview ? (
                  <>
                    <StatusBlock ok lines={[`匹配：${preview.messageName}`, `字段：${preview.fields.length}`]} />
                    <div className="divide-y divide-border/60 rounded-lg border border-border/60">
                      {preview.fields.map((field) => (
                        <div key={field.key} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{field.name}</div>
                            <div className="font-mono text-muted-foreground">
                              {field.key} · @{field.offset}
                            </div>
                          </div>
                          <span className="shrink-0 font-mono">
                            {field.value}
                            {field.unit ? ` ${field.unit}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <StatusBlock
                    ok={false}
                    lines={[previewBytes?.length ? "尚未形成完整有效帧，请核对长度和 CRC" : "请输入一帧 HEX 样本"]}
                  />
                )}
              </section>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center border-t border-border/60 px-5 py-3 sm:justify-between sm:space-x-0">
          <div className={`text-xs ${errors.length > 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {status ||
              (errors.length > 0
                ? errors[0]
                : `${draft.messages.length} 条消息 · ${draft.messages.reduce((sum, message) => sum + message.fields.length, 0)} 个字段`)}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={errors.length > 0} onClick={applyProtocol}>
              应用协议
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function newField(number: number): BinaryFieldConfig {
  return {
    key: `field${number}`,
    name: `字段 ${number}`,
    type: "uint16",
    offsetBase: "payload",
    offset: (number - 1) * 2,
    byteOrder: "little",
    count: 1,
    stride: 2,
    scale: 1,
    bias: 0,
    bitOffset: 0,
    bitLength: 8,
  };
}

function normalizeFieldPatch(field: BinaryFieldConfig, patch: Partial<BinaryFieldConfig>): BinaryFieldConfig {
  const next = { ...field, ...patch };
  return { ...next, count: Math.max(1, Math.floor(next.count)), stride: Math.max(0, Math.floor(next.stride)) };
}

function findPresetId(protocol: BinaryProtocolConfig): string {
  const checksum = protocol.checksum;
  return (
    BINARY_CHECKSUM_PRESETS.find(({ config }) =>
      Object.entries(config).every(([key, value]) => checksum[key as keyof typeof config] === value)
    )?.id ?? "custom"
  );
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-") || "binary-protocol";
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

function FormGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid gap-3 sm:grid-cols-2 ${className}`}>{children}</div>;
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </Field>
  );
}

function ByteOrderField({ value, onChange }: { value: BinaryByteOrder; onChange: (value: BinaryByteOrder) => void }) {
  return (
    <Field label="字节序">
      <Select value={value} onValueChange={(byteOrder: BinaryByteOrder) => onChange(byteOrder)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="little">小端</SelectItem>
          <SelectItem value="big">大端</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function HexNumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(`0x${(value >>> 0).toString(16).toUpperCase()}`);
  useEffect(() => setText(`0x${(value >>> 0).toString(16).toUpperCase()}`), [value]);
  return (
    <Field label={label}>
      <Input
        className="font-mono"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (/^(?:0x)?[0-9a-f]+$/i.test(next)) onChange(Number.parseInt(next.replace(/^0x/i, ""), 16) >>> 0);
        }}
      />
    </Field>
  );
}

function HexBytesInput({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  const [text, setText] = useState(() => formatHexBytes(value));
  useEffect(() => setText(formatHexBytes(value)), [value]);
  return (
    <Input
      className="font-mono"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = parseHexBytes(next);
        if (parsed) onChange(parsed);
      }}
    />
  );
}

function StatusBlock({ ok, lines }: { ok: boolean; lines: string[] }) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${ok ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BytePreview({
  bytes,
  preview,
}: {
  bytes: number[];
  preview?: ReturnType<BinaryProtocolStream["ingest"]>["frames"][number];
}) {
  const ranges = preview?.fields ?? [];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-xs">
      {bytes.map((byte, index) => {
        const fieldIndex = ranges.findIndex((field) => index >= field.offset && index < field.offset + field.size);
        const colors = ["bg-blue-500/20", "bg-green-500/20", "bg-amber-500/20", "bg-red-500/20", "bg-cyan-500/20"];
        return (
          <span
            key={index}
            title={fieldIndex >= 0 ? ranges[fieldIndex].name : `offset ${index}`}
            className={`rounded px-1 py-0.5 ${fieldIndex >= 0 ? colors[fieldIndex % colors.length] : "bg-muted"}`}
          >
            {byte.toString(16).toUpperCase().padStart(2, "0")}
          </span>
        );
      })}
    </div>
  );
}
