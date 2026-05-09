import type { Campaign } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function DeleteCampaignDialog({
  campaign,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  campaign?: Campaign;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除断点</DialogTitle>
          <DialogDescription>
            确定删除「{campaign?.title ?? "该战役"}」吗？对应的断点、消息和战役角色会被删除；如果使用了角色库卡片，该卡片会被释放。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LoadingShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-4 px-6 py-6">
      <Skeleton className="h-[700px] w-80" />
      <Skeleton className="h-[700px] flex-1" />
    </div>
  );
}
