import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { MemoryRegion } from "@/lib/types";
import { formatBytes, formatHex } from "@/lib/utils";

/** 后端单次读取上限（与 read_flash 保持一致） */
const MAX_READ_SIZE = 64 * 1024 * 1024;

interface ReadFlashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 芯片的 Flash 区域，第一个作为默认读取范围 */
  regions: MemoryRegion[];
  onConfirm: (address: number, size: number) => void;
}

function parseHex(value: string): number {
  const digits = value.trim().replace(/^0x/i, "");
  return /^[0-9a-f]+$/i.test(digits) ? parseInt(digits, 16) : NaN;
}

export function ReadFlashDialog({ open, onOpenChange, regions, onConfirm }: ReadFlashDialogProps) {
  const defaultRegion = regions[0];
  const defaultAddress = defaultRegion?.address ?? 0x08000000;
  const defaultSize = defaultRegion?.size ?? 0x10000;

  const [address, setAddress] = useState(formatHex(defaultAddress));
  const [size, setSize] = useState(formatHex(defaultSize));
  const [error, setError] = useState<string | null>(null);
  // 同一芯片下保留上次填写的范围；换了芯片（默认值变化）才重新填入默认值
  const appliedDefaults = useRef("");

  useEffect(() => {
    if (!open) return;
    const key = `${defaultAddress}:${defaultSize}`;
    if (appliedDefaults.current !== key) {
      appliedDefaults.current = key;
      setAddress(formatHex(defaultAddress));
      setSize(formatHex(defaultSize));
    }
    setError(null);
  }, [open, defaultAddress, defaultSize]);

  const fillRegion = (region: MemoryRegion) => {
    setAddress(formatHex(region.address));
    setSize(formatHex(region.size));
    setError(null);
  };

  const handleConfirm = () => {
    const addr = parseHex(address);
    const sz = parseHex(size);
    if (isNaN(addr) || isNaN(sz) || sz <= 0) {
      setError("请输入有效的起始地址和长度（十六进制）");
      return;
    }
    if (sz > MAX_READ_SIZE) {
      setError("单次最多读取 64 MB");
      return;
    }
    onConfirm(addr, sz);
    onOpenChange(false);
  };

  const parsedSize = parseHex(size);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>读取 Flash</DialogTitle>
          <DialogDescription>读取指定地址范围的内容并保存为 BIN 文件，默认读取芯片的主 Flash。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {regions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">快速选择区域</Label>
              <div className="flex flex-wrap gap-2">
                {regions.map((region, index) => (
                  <Button
                    key={`${region.address}-${index}`}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => fillRegion(region)}
                  >
                    {region.name || `Flash ${index + 1}`} · {formatBytes(region.size)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="read-address" className="text-xs">
              起始地址（十六进制）
            </Label>
            <Input
              id="read-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x08000000"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="read-size" className="text-xs">
              读取长度（十六进制）
            </Label>
            <Input
              id="read-size"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="0x10000"
              className="font-mono text-xs"
            />
            {parsedSize > 0 && <p className="text-xs text-muted-foreground">共 {formatBytes(parsedSize)}</p>}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>选择保存位置并读取</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
