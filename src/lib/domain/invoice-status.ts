import { daysBetweenIso, todayIso } from "./czech";
import { formatShortDateCz } from "./money";

export type DerivedInvoiceStatus =
  | "draft"
  | "sent"
  | "partial"
  | "overdue"
  | "paid"
  | "cancelled";

export interface InvoiceStatusInput {
  status: string; // draft | issued | cancelled
  totalMinor: number;
  paidMinor: number;
  dueDate: string;
  paidAt?: string | null;
}

export interface InvoiceStatusInfo {
  derived: DerivedInvoiceStatus;
  label: string;
  daysOverdue: number;
  daysUntilDue: number;
  remainingMinor: number;
  dueSubtext: string;
  isDangerSubtext: boolean;
}

export function deriveInvoiceStatus(
  inv: InvoiceStatusInput,
  referenceDateIso = todayIso(),
): InvoiceStatusInfo {
  const remainingMinor = Math.max(0, inv.totalMinor - inv.paidMinor);
  const diff = daysBetweenIso(referenceDateIso, inv.dueDate); // > 0 in future, < 0 overdue
  const daysOverdue = diff < 0 ? Math.abs(diff) : 0;
  const daysUntilDue = diff > 0 ? diff : 0;

  if (inv.status === "cancelled") {
    return {
      derived: "cancelled",
      label: "Stornováno",
      daysOverdue: 0,
      daysUntilDue: 0,
      remainingMinor: 0,
      dueSubtext: "stornováno",
      isDangerSubtext: false,
    };
  }

  if (inv.status === "draft") {
    return {
      derived: "draft",
      label: "Koncept",
      daysOverdue: 0,
      daysUntilDue,
      remainingMinor: inv.totalMinor,
      dueSubtext: "nevystaveno",
      isDangerSubtext: false,
    };
  }

  if (inv.totalMinor > 0 && inv.paidMinor >= inv.totalMinor) {
    return {
      derived: "paid",
      label: "Zaplaceno",
      daysOverdue: 0,
      daysUntilDue: 0,
      remainingMinor: 0,
      dueSubtext: inv.paidAt ? `uhrazeno ${formatShortDateCz(inv.paidAt)}` : "uhrazeno",
      isDangerSubtext: false,
    };
  }

  if (daysOverdue > 0) {
    return {
      derived: "overdue",
      label: "Po splatnosti",
      daysOverdue,
      daysUntilDue: 0,
      remainingMinor,
      dueSubtext:
        daysOverdue === 1
          ? "1 den po splatnosti"
          : daysOverdue <= 4
            ? `${daysOverdue} dny po splatnosti`
            : `${daysOverdue} dní po splatnosti`,
      isDangerSubtext: true,
    };
  }

  const dueSubtext =
    daysUntilDue === 0
      ? "splatnost dnes"
      : daysUntilDue === 1
        ? "za 1 den"
        : daysUntilDue <= 4
          ? `za ${daysUntilDue} dny`
          : `za ${daysUntilDue} dní`;

  if (inv.paidMinor > 0) {
    return {
      derived: "partial",
      label: "Částečně uhrazeno",
      daysOverdue: 0,
      daysUntilDue,
      remainingMinor,
      dueSubtext,
      isDangerSubtext: false,
    };
  }

  return {
    derived: "sent",
    label: "Čeká na úhradu",
    daysOverdue: 0,
    daysUntilDue,
    remainingMinor,
    dueSubtext,
    isDangerSubtext: false,
  };
}
