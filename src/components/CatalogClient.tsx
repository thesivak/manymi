"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  formatCzk,
  formatDateCz,
  formatQuantity,
  parseCzechAmountToMinor,
  parseCzechQuantityToMilli,
} from "@/lib/domain/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CatalogItem } from "@/db/schema";

interface StockMovementRow {
  id: string;
  itemName: string;
  unit: string;
  direction: string;
  quantityMilli: number;
  unitPriceMinor: number;
  sourceDocType: string;
  note: string;
  movedAt: string;
}

interface SalesOverviewRow {
  name: string;
  unit: string;
  quantityMilli: number;
  subtotalMinor: number;
  totalMinor: number;
}

export function CatalogClient({
  items,
  movements,
  salesOverview,
}: {
  items: CatalogItem[];
  movements: StockMovementRow[];
  salesOverview: SalesOverviewRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"items" | "stock" | "sales">("items");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const [form, setForm] = useState({
    name: "",
    sku: "",
    ean: "",
    unit: "ks",
    priceCzk: "",
    priceType: "without_vat",
    vatRate: 21,
    trackStock: false,
    initialStock: "0",
  });

  const [moveForm, setMoveForm] = useState({
    catalogItemId: items[0]?.id ?? "",
    direction: "in" as "in" | "out",
    quantity: "1",
    note: "",
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          ean: form.ean,
          unit: form.unit,
          unitPriceMinor: parseCzechAmountToMinor(form.priceCzk),
          priceType: form.priceType,
          vatRate: form.vatRate,
          trackStock: form.trackStock,
          stockQuantityMilli: form.trackStock ? parseCzechQuantityToMilli(form.initialStock) : 0,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setForm({
          name: "",
          sku: "",
          ean: "",
          unit: "ks",
          priceCzk: "",
          priceType: "without_vat",
          vatRate: 21,
          trackStock: false,
          initialStock: "0",
        });
        showToast("Položka byla přidána do ceníku.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function recordMovement(e: React.FormEvent) {
    e.preventDefault();
    const effectiveItemId = moveForm.catalogItemId || items[0]?.id || "";
    if (!effectiveItemId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "stock_movement",
          catalogItemId: effectiveItemId,
          direction: moveForm.direction,
          quantityMilli: parseCzechQuantityToMilli(moveForm.quantity),
          note: moveForm.note,
        }),
      });
      if (res.ok) {
        setMoveForm((p) => ({ ...p, catalogItemId: effectiveItemId, note: "", quantity: "1" }));
        showToast("Skladový pohyb byl zapsán.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Katalog položek, sklad a přehled prodejů</p>
          <h1 className="display h-page">Ceník</h1>
        </div>
        <div className="actions">
          <Button
            type="button"
            onClick={() => {
              setTab("items");
              setShowForm((v) => !v);
            }}
          >
            <Plus className="size-4" />
            Nová položka ceníku
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="items">
              Položky ceníku <span className="text-xs text-muted-foreground num">{items.length}</span>
            </TabsTrigger>
            <TabsTrigger value="stock">
              Skladové pohyby <span className="text-xs text-muted-foreground num">{movements.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sales">
              Přehled prodeje <span className="text-xs text-muted-foreground num">{salesOverview.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {showForm && tab === "items" && (
        <Card className="mb-6 border-foreground">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Nová položka ceníku</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createItem} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cat-name">Název</Label>
                  <Input
                    id="cat-name"
                    required
                    placeholder="Vývojová hodina senior"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-sku">Katalogové číslo (SKU)</Label>
                  <Input
                    id="cat-sku"
                    className="mono"
                    value={form.sku}
                    onChange={(e) => setForm((p) => ({ ...p, sku: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-ean">EAN</Label>
                  <Input
                    id="cat-ean"
                    className="num"
                    value={form.ean}
                    onChange={(e) => setForm((p) => ({ ...p, ean: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cat-price">Jednotková cena (Kč)</Label>
                  <Input
                    id="cat-price"
                    className="num text-right"
                    required
                    value={form.priceCzk}
                    onChange={(e) => setForm((p) => ({ ...p, priceCzk: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-unit">Jednotka</Label>
                  <Input
                    id="cat-unit"
                    value={form.unit}
                    onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-vat">Sazba DPH</Label>
                  <Select
                    id="cat-vat"
                    className="num"
                    value={form.vatRate}
                    onChange={(e) => setForm((p) => ({ ...p, vatRate: Number(e.target.value) }))}
                  >
                    <option value={21}>21 %</option>
                    <option value={12}>12 %</option>
                    <option value={0}>0 %</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.trackStock}
                    onChange={(e) => setForm((p) => ({ ...p, trackStock: e.target.checked }))}
                  />
                  Sledovat stav skladu
                </label>
                {form.trackStock && (
                  <label className="inline-flex items-center gap-2 text-sm">
                    Počáteční množství:
                    <Input
                      className="h-8 w-24 num text-right"
                      value={form.initialStock}
                      onChange={(e) => setForm((p) => ({ ...p, initialStock: e.target.value }))}
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" disabled={busy}>
                  Přidat položku
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "items" &&
        (items.length === 0 ? (
          <Card className="p-9">
            <p className="text-sm text-muted-foreground">
              Ceník je zatím prázdný. Přidejte služby nebo zboží pro rychlé vkládání do faktur.
            </p>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Položka</TableHead>
                <TableHead>Kód / EAN</TableHead>
                <TableHead className="text-right">Stav skladu</TableHead>
                <TableHead className="text-right">Cena / MJ</TableHead>
                <TableHead className="text-right">DPH</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-semibold">{it.name}</TableCell>
                  <TableCell className="mono text-xs text-muted-foreground">
                    {[it.sku, it.ean].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-right num">
                    {it.trackStock
                      ? `${formatQuantity(it.stockQuantityMilli)} ${it.unit}`
                      : "nesledováno"}
                  </TableCell>
                  <TableCell className="text-right font-bold num">
                    {formatCzk(it.unitPriceMinor, { currency: it.currency })} / {it.unit}
                  </TableCell>
                  <TableCell className="text-right num">{it.vatRate} %</TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                      onClick={async () => {
                        await fetch(`/api/catalog?id=${it.id}`, { method: "DELETE" });
                        router.refresh();
                      }}
                    >
                      Smazat
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}

      {tab === "stock" && (
        <div className="space-y-6">
          {items.length > 0 && (
            <Card className="border-foreground">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Zapsat skladový pohyb</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={recordMovement} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Select
                      value={moveForm.catalogItemId || items[0]?.id || ""}
                      onChange={(e) => setMoveForm((p) => ({ ...p, catalogItemId: e.target.value }))}
                    >
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({formatQuantity(it.stockQuantityMilli)} {it.unit})
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={moveForm.direction}
                      onChange={(e) =>
                        setMoveForm((p) => ({ ...p, direction: e.target.value as "in" | "out" }))
                      }
                    >
                      <option value="in">Příjem na sklad (+)</option>
                      <option value="out">Výdej ze skladu (−)</option>
                    </Select>
                    <Input
                      className="num text-right"
                      placeholder="Množství"
                      value={moveForm.quantity}
                      onChange={(e) => setMoveForm((p) => ({ ...p, quantity: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Input
                      placeholder="Poznámka (např. Naskladnění dodávky)"
                      value={moveForm.note}
                      onChange={(e) => setMoveForm((p) => ({ ...p, note: e.target.value }))}
                    />
                    <Button type="submit" variant="outline" disabled={busy}>
                      Zapsat pohyb
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Položka</TableHead>
                <TableHead>Směr</TableHead>
                <TableHead className="text-right">Množství</TableHead>
                <TableHead>Poznámka</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Zatím nejsou zapsány žádné skladové pohyby.
                  </TableCell>
                </TableRow>
              ) : (
                movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="num whitespace-nowrap">{formatDateCz(m.movedAt)}</TableCell>
                    <TableCell className="font-semibold">{m.itemName}</TableCell>
                    <TableCell>
                      <Badge variant={m.direction === "in" ? "default" : "outline"}>
                        {m.direction === "in" ? "Příjem" : "Výdej"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold num">
                      {m.direction === "in" ? "+" : "−"}
                      {formatQuantity(m.quantityMilli)} {m.unit}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.note}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "sales" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Položka</TableHead>
              <TableHead className="text-right">Prodané množství</TableHead>
              <TableHead className="text-right">Tržba bez DPH</TableHead>
              <TableHead className="text-right">Tržba s DPH</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salesOverview.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Zatím nejsou vystaveny žádné faktury.
                </TableCell>
              </TableRow>
            ) : (
              salesOverview.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-semibold">{row.name}</TableCell>
                  <TableCell className="text-right num">
                    {formatQuantity(row.quantityMilli)} {row.unit}
                  </TableCell>
                  <TableCell className="text-right num">{formatCzk(row.subtotalMinor)}</TableCell>
                  <TableCell className="text-right font-bold num">
                    {formatCzk(row.totalMinor)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
