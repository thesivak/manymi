import { Badge } from "@/components/ui/badge";
import type { DerivedInvoiceStatus } from "@/lib/domain/invoice-status";

const LABELS: Record<DerivedInvoiceStatus, string> = {
  draft: "Koncept",
  sent: "Čeká na úhradu",
  partial: "Částečně uhrazeno",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};

const VARIANT_MAP: Record<
  DerivedInvoiceStatus,
  "default" | "secondary" | "outline" | "destructive" | "muted"
> = {
  draft: "muted",
  sent: "outline",
  partial: "secondary",
  overdue: "destructive",
  paid: "default",
  cancelled: "muted",
};

export function StatusBadge({ status }: { status: DerivedInvoiceStatus }) {
  return (
    <Badge variant={VARIANT_MAP[status]}>
      {status === "overdue" && (
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
      )}
      {status === "paid" && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
      )}
      {LABELS[status]}
    </Badge>
  );
}
