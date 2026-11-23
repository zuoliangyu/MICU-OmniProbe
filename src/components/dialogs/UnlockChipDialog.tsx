import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface UnlockChipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chipName: string;
  onConfirm: () => void;
}

/** 解锁芯片前的确认：解锁会整片擦除 Flash，必须让用户明确同意 */
export function UnlockChipDialog({ open, onOpenChange, chipName, onConfirm }: UnlockChipDialogProps) {
  const handleConfirm = () => {
    onOpenChange(false);
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            解锁芯片
          </DialogTitle>
          <DialogDescription>将以解锁模式重新连接 {chipName}，并擦除全部 Flash。此操作不可恢复。</DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1.5 py-2 pl-5 text-xs text-muted-foreground">
          <li>芯片内的程序和数据（包括读保护下无法读出的内容）都会被清除。</li>
          <li>芯片自带解锁序列的（如 nRF 系列的 APPROTECT）会同时解除读保护，芯片被锁、普通连接失败时也可使用。</li>
          <li>
            需要修改选项字节才能解除的保护（如 STM32 的 RDP）这里无法解除，只会尝试整片擦除，请改用芯片厂商工具（如
            STM32CubeProgrammer）。
          </li>
          <li>完成后保持连接，可直接烧录新固件。</li>
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            擦除并解锁
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
