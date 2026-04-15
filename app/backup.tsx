"use client";
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FileSpreadsheet, FileText, AlertTriangle, Calculator, Settings, Users, DollarSign } from "lucide-react";

const initialProviders = [
  {
    id: "p1",
    name: "Dr Sarah Patel",
    specialty: "Periodontist",
    status: "In Review",
    formula: {
      type: "flat",
      percent: 40,
      deductAdjustments: true,
      deductIncorrectPayments: true,
      deductIVFees: true,
      deductMerchantFees: true,
      includedCustomCategoryIds: ["focus_owed", "fees_received_incorrectly"],
    },
    monthly: {
      grossProduction: 120000,
      adjustments: 2500,
      incorrectPayments: 800,
      ivFacilityFees: 2000,
      afterpayFees: 260,
      hummFees: 140,
    },
  },
  {
    id: "p2",
    name: "Dr James Wong",
    specialty: "Oral & Maxillofacial Surgeon",
    status: "Ready",
    formula: {
      type: "flat",
      percent: 45,
      deductAdjustments: true,
      deductIncorrectPayments: true,
      deductIVFees: true,
      deductMerchantFees: true,
      includedCustomCategoryIds: ["focus_owed"],
    },
    monthly: {
      grossProduction: 168000,
      adjustments: 4200,
      incorrectPayments: 0,
      ivFacilityFees: 3500,
      afterpayFees: 320,
      hummFees: 280,
    },
  },
  {
    id: "p3",
    name: "Dr Emily Chen",
    specialty: "Periodontist",
    status: "Needs Review",
    formula: {
      type: "flat",
      percent: 38,
      deductAdjustments: true,
      deductIncorrectPayments: false,
      deductIVFees: true,
      deductMerchantFees: true,
      includedCustomCategoryIds: ["fees_received_incorrectly"],
    },
    monthly: {
      grossProduction: 94000,
      adjustments: 1800,
      incorrectPayments: 500,
      ivFacilityFees: 1200,
      afterpayFees: 100,
      hummFees: 90,
    },
  },
];

const initialCategories = [
  { id: "focus_owed", name: "Fees paid to provider owed to Focus", type: "deduction" },
  { id: "fees_received_incorrectly", name: "Fees received incorrectly", type: "deduction" },
  { id: "practice_retained", name: "Practice retained fees", type: "retained" },
];

const initialPatientCosts = [
  {
    id: "c1",
    providerId: "p1",
    patientName: "John Smith",
    date: "2026-03-05",
    category: "Lab",
    supplier: "Precision Dental Lab",
    reference: "LAB-1042",
    amount: 1200,
    notes: "Bone graft membrane",
  },
  {
    id: "c2",
    providerId: "p1",
    patientName: "Mia Brown",
    date: "2026-03-08",
    category: "Implant",
    supplier: "Nobel Biocare",
    reference: "IMP-3381",
    amount: 2400,
    notes: "Implant fixture",
  },
  {
    id: "c3",
    providerId: "p2",
    patientName: "Ava Wilson",
    date: "2026-03-14",
    category: "Surgical Guide",
    supplier: "DDN",
    reference: "SG-220",
    amount: 650,
    notes: "Single implant guide",
  },
  {
    id: "c4",
    providerId: "p2",
    patientName: "Luca Taylor",
    date: "2026-03-16",
    category: "Biomaterial",
    supplier: "Straumann",
    reference: "BIO-901",
    amount: 980,
    notes: "Biomaterial recorded in Praktika",
  },
];

const initialCustomEntries = [
  { id: "e1", providerId: "p1", categoryId: "focus_owed", patientName: "", amount: 900, notes: "Collected in provider account" },
  { id: "e2", providerId: "p1", categoryId: "fees_received_incorrectly", patientName: "Oliver Green", amount: 300, notes: "Wrong deposit" },
  { id: "e3", providerId: "p2", categoryId: "focus_owed", patientName: "", amount: 450, notes: "Manual correction" },
];

const initialExceptions = [
  { id: "x1", providerId: "p1", type: "$0 appointment", patientName: "Noah White", amount: 0, status: "Open" },
  { id: "x2", providerId: "p2", type: "Incomplete appointment", patientName: "Isla Scott", amount: 0, status: "Open" },
  { id: "x3", providerId: "p3", type: "Incorrect payment", patientName: "Leo Hall", amount: 500, status: "Investigating" },
];

function fmtCurrency(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value || 0);
}

function sum(arr) {
  return arr.reduce((acc, val) => acc + (Number(val) || 0), 0);
}

function App() {
  const [providers, setProviders] = useState(initialProviders);
  const [categories, setCategories] = useState(initialCategories);
  const [patientCosts, setPatientCosts] = useState(initialPatientCosts);
  const [customEntries, setCustomEntries] = useState(initialCustomEntries);
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [selectedProviderId, setSelectedProviderId] = useState(initialProviders[0].id);
  const [period, setPeriod] = useState("March 2026");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] = useState("deduction");
  const [newCost, setNewCost] = useState({
    providerId: initialProviders[0].id,
    patientName: "",
    date: "2026-03-31",
    category: "Lab",
    supplier: "",
    reference: "",
    amount: "",
    notes: "",
  });

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) || providers[0],
    [providers, selectedProviderId]
  );

  const providerCalculations = useMemo(() => {
    return providers.map((provider) => {
      const costs = patientCosts.filter((c) => c.providerId === provider.id);
      const custom = customEntries.filter((c) => c.providerId === provider.id);
      const costTotal = sum(costs.map((c) => c.amount));
      const merchantFees = (provider.monthly.afterpayFees || 0) + (provider.monthly.hummFees || 0);
      const includedCustom = sum(
        custom
          .filter((entry) => provider.formula.includedCustomCategoryIds.includes(entry.categoryId))
          .map((entry) => entry.amount)
      );

      const feeBase =
        (provider.monthly.grossProduction || 0) -
        (provider.formula.deductAdjustments ? provider.monthly.adjustments || 0 : 0) -
        (provider.formula.deductIncorrectPayments ? provider.monthly.incorrectPayments || 0 : 0) -
        (provider.formula.deductIVFees ? provider.monthly.ivFacilityFees || 0 : 0) -
        costTotal -
        (provider.formula.deductMerchantFees ? merchantFees : 0) -
        includedCustom;

      const serviceFee = feeBase * ((provider.formula.percent || 0) / 100);
      const practiceRetained = provider.monthly.ivFacilityFees || 0;
      const providerExceptions = exceptions.filter((e) => e.providerId === provider.id);

      return {
        providerId: provider.id,
        costTotal,
        merchantFees,
        includedCustom,
        feeBase,
        serviceFee,
        practiceRetained,
        exceptions: providerExceptions.length,
      };
    });
  }, [providers, patientCosts, customEntries, exceptions]);

  const selectedCalc = providerCalculations.find((c) => c.providerId === selectedProviderId);

  const totals = useMemo(() => {
    return {
      grossProduction: sum(providers.map((p) => p.monthly.grossProduction)),
      deductions: sum(providerCalculations.map((c) => {
        const provider = providers.find((p) => p.id === c.providerId);
        if (!provider) return 0;
        return (
          (provider.formula.deductAdjustments ? provider.monthly.adjustments : 0) +
          (provider.formula.deductIncorrectPayments ? provider.monthly.incorrectPayments : 0) +
          (provider.formula.deductIVFees ? provider.monthly.ivFacilityFees : 0) +
          c.costTotal +
          (provider.formula.deductMerchantFees ? c.merchantFees : 0) +
          c.includedCustom
        );
      })),
      serviceFees: sum(providerCalculations.map((c) => c.serviceFee)),
      retained: sum(providerCalculations.map((c) => c.practiceRetained)),
      exceptions: exceptions.filter((e) => e.status !== "Resolved").length,
    };
  }, [providers, providerCalculations, exceptions]);

  const updateProviderMonthly = (providerId, key, value) => {
    setProviders((prev) =>
      prev.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              monthly: {
                ...provider.monthly,
                [key]: Number(value) || 0,
              },
            }
          : provider
      )
    );
  };

  const updateProviderFormula = (providerId, key, value) => {
    setProviders((prev) =>
      prev.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              formula: {
                ...provider.formula,
                [key]: value,
              },
            }
          : provider
      )
    );
  };

  const addCategory = () => {
    if (!newCategoryName.trim()) return;
    const id = newCategoryName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    setCategories((prev) => [...prev, { id, name: newCategoryName.trim(), type: newCategoryType }]);
    setNewCategoryName("");
  };

  const addPatientCost = () => {
    if (!newCost.patientName || !newCost.amount) return;
    setPatientCosts((prev) => [
      ...prev,
      {
        ...newCost,
        id: `c${prev.length + 1}`,
        amount: Number(newCost.amount),
      },
    ]);
    setNewCost({
      providerId: selectedProviderId,
      patientName: "",
      date: "2026-03-31",
      category: "Lab",
      supplier: "",
      reference: "",
      amount: "",
      notes: "",
    });
  };

  const selectedProviderCosts = patientCosts.filter((c) => c.providerId === selectedProviderId);
  const selectedProviderCustomEntries = customEntries.filter((c) => c.providerId === selectedProviderId);
  const selectedProviderExceptions = exceptions.filter((e) => e.providerId === selectedProviderId);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl p-6 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Service Fee Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Interactive prototype for specialist billing, cost tracking, provider fee calculations, and monthly exports.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[180px] rounded-2xl bg-white">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="March 2026">March 2026</SelectItem>
                <SelectItem value="April 2026">April 2026</SelectItem>
                <SelectItem value="May 2026">May 2026</SelectItem>
              </SelectContent>
            </Select>
            <Button className="rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> Export Excel</Button>
            <Button variant="outline" className="rounded-2xl"><FileText className="mr-2 h-4 w-4" /> Generate Statements</Button>
          </div>
        </motion.div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Gross Production", value: fmtCurrency(totals.grossProduction), icon: DollarSign },
            { label: "Total Deductions", value: fmtCurrency(totals.deductions), icon: Calculator },
            { label: "Service Fees Payable", value: fmtCurrency(totals.serviceFees), icon: FileText },
            { label: "Practice Retained", value: fmtCurrency(totals.retained), icon: FileSpreadsheet },
            { label: "Open Exceptions", value: String(totals.exceptions), icon: AlertTriangle },
          ].map((item) => (
            <Card key={item.label} className="rounded-3xl border-0 shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-slate-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3">
                  <item.icon className="h-5 w-5 text-slate-700" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5" /> Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {providers.map((provider) => {
                  const calc = providerCalculations.find((c) => c.providerId === provider.id);
                  const isActive = selectedProviderId === provider.id;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => setSelectedProviderId(provider.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{provider.name}</div>
                          <div className={`text-sm ${isActive ? "text-slate-300" : "text-slate-500"}`}>{provider.specialty}</div>
                        </div>
                        <Badge variant={isActive ? "secondary" : "outline"}>{provider.status}</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className={isActive ? "text-slate-300" : "text-slate-500"}>Fee Base</div>
                          <div className="font-semibold">{fmtCurrency(calc?.feeBase || 0)}</div>
                        </div>
                        <div>
                          <div className={isActive ? "text-slate-300" : "text-slate-500"}>Payable</div>
                          <div className="font-semibold">{fmtCurrency(calc?.serviceFee || 0)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="dashboard" className="space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-white p-1 md:grid-cols-5">
              <TabsTrigger value="dashboard" className="rounded-xl">Dashboard</TabsTrigger>
              <TabsTrigger value="worksheet" className="rounded-xl">Provider Worksheet</TabsTrigger>
              <TabsTrigger value="costs" className="rounded-xl">Patient Costs</TabsTrigger>
              <TabsTrigger value="formulas" className="rounded-xl">Formula Settings</TabsTrigger>
              <TabsTrigger value="exports" className="rounded-xl">Exports</TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="rounded-3xl border-0 shadow-sm lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Monthly Provider Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Gross</TableHead>
                          <TableHead>Fee Base</TableHead>
                          <TableHead>Service Fee</TableHead>
                          <TableHead>Retained</TableHead>
                          <TableHead>Exceptions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {providers.map((provider) => {
                          const calc = providerCalculations.find((c) => c.providerId === provider.id);
                          return (
                            <TableRow key={provider.id}>
                              <TableCell>
                                <div className="font-medium">{provider.name}</div>
                                <div className="text-xs text-slate-500">{provider.specialty}</div>
                              </TableCell>
                              <TableCell>{fmtCurrency(provider.monthly.grossProduction)}</TableCell>
                              <TableCell>{fmtCurrency(calc?.feeBase || 0)}</TableCell>
                              <TableCell>{fmtCurrency(calc?.serviceFee || 0)}</TableCell>
                              <TableCell>{fmtCurrency(calc?.practiceRetained || 0)}</TableCell>
                              <TableCell><Badge variant="outline">{calc?.exceptions || 0}</Badge></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Exception Queue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {exceptions.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{item.type}</div>
                          <Badge variant={item.status === "Resolved" ? "secondary" : "outline"}>{item.status}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{providers.find((p) => p.id === item.providerId)?.name}</div>
                        <div className="text-sm text-slate-600">{item.patientName}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="worksheet" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>{selectedProvider.name} · Monthly Inputs</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {[
                      ["grossProduction", "Gross Production"],
                      ["adjustments", "Adjustments"],
                      ["incorrectPayments", "Incorrect Payments"],
                      ["ivFacilityFees", "IV Facility Fees"],
                      ["afterpayFees", "Afterpay Fees ex GST"],
                      ["hummFees", "Humm Fees ex GST"],
                    ].map(([key, label]) => (
                      <div key={key} className="space-y-2">
                        <Label>{label}</Label>
                        <Input
                          type="number"
                          value={selectedProvider.monthly[key]}
                          onChange={(e) => updateProviderMonthly(selectedProvider.id, key, e.target.value)}
                          className="rounded-2xl"
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Calculation Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <SummaryRow label="Gross Production" value={fmtCurrency(selectedProvider.monthly.grossProduction)} />
                    <SummaryRow label="Adjustments" value={`- ${fmtCurrency(selectedProvider.formula.deductAdjustments ? selectedProvider.monthly.adjustments : 0)}`} />
                    <SummaryRow label="Incorrect Payments" value={`- ${fmtCurrency(selectedProvider.formula.deductIncorrectPayments ? selectedProvider.monthly.incorrectPayments : 0)}`} />
                    <SummaryRow label="IV Facility Fees" value={`- ${fmtCurrency(selectedProvider.formula.deductIVFees ? selectedProvider.monthly.ivFacilityFees : 0)}`} />
                    <SummaryRow label="Patient-linked Costs" value={`- ${fmtCurrency(selectedCalc?.costTotal || 0)}`} />
                    <SummaryRow label="Merchant Fees" value={`- ${fmtCurrency(selectedProvider.formula.deductMerchantFees ? selectedCalc?.merchantFees || 0 : 0)}`} />
                    <SummaryRow label="Custom Category Deductions" value={`- ${fmtCurrency(selectedCalc?.includedCustom || 0)}`} />
                    <Separator />
                    <SummaryRow label="Fee Base" value={fmtCurrency(selectedCalc?.feeBase || 0)} strong />
                    <SummaryRow label={`Service Fee (${selectedProvider.formula.percent}%)`} value={fmtCurrency(selectedCalc?.serviceFee || 0)} strong />
                    <SummaryRow label="Practice Retained (IV fees)" value={fmtCurrency(selectedCalc?.practiceRetained || 0)} />
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Custom Category Entries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead>Patient</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedProviderCustomEntries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>{categories.find((c) => c.id === entry.categoryId)?.name}</TableCell>
                            <TableCell>{entry.patientName || "—"}</TableCell>
                            <TableCell>{fmtCurrency(entry.amount)}</TableCell>
                            <TableCell>{entry.notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Provider Exceptions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedProviderExceptions.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{item.type}</div>
                          <Badge variant="outline">{item.status}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{item.patientName}</div>
                        <div className="text-sm text-slate-500">{fmtCurrency(item.amount)}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="costs" className="space-y-4">
              <Card className="rounded-3xl border-0 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Patient Cost Register</CardTitle>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button className="rounded-2xl"><Plus className="mr-2 h-4 w-4" /> Add Cost Entry</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl rounded-3xl">
                      <DialogHeader>
                        <DialogTitle>Add Patient-linked Cost</DialogTitle>
                      </DialogHeader>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Provider</Label>
                          <Select value={newCost.providerId} onValueChange={(value) => setNewCost((prev) => ({ ...prev, providerId: value }))}>
                            <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {providers.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Patient Name</Label>
                          <Input value={newCost.patientName} onChange={(e) => setNewCost((prev) => ({ ...prev, patientName: e.target.value }))} className="rounded-2xl" />
                        </div>
                        <div className="space-y-2">
                          <Label>Date</Label>
                          <Input type="date" value={newCost.date} onChange={(e) => setNewCost((prev) => ({ ...prev, date: e.target.value }))} className="rounded-2xl" />
                        </div>
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select value={newCost.category} onValueChange={(value) => setNewCost((prev) => ({ ...prev, category: value }))}>
                            <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {['Lab', 'Implant', 'Biomaterial', 'Surgical Guide', 'Other'].map((item) => (
                                <SelectItem key={item} value={item}>{item}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Supplier</Label>
                          <Input value={newCost.supplier} onChange={(e) => setNewCost((prev) => ({ ...prev, supplier: e.target.value }))} className="rounded-2xl" />
                        </div>
                        <div className="space-y-2">
                          <Label>Reference</Label>
                          <Input value={newCost.reference} onChange={(e) => setNewCost((prev) => ({ ...prev, reference: e.target.value }))} className="rounded-2xl" />
                        </div>
                        <div className="space-y-2">
                          <Label>Amount</Label>
                          <Input type="number" value={newCost.amount} onChange={(e) => setNewCost((prev) => ({ ...prev, amount: e.target.value }))} className="rounded-2xl" />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Notes</Label>
                          <Textarea value={newCost.notes} onChange={(e) => setNewCost((prev) => ({ ...prev, notes: e.target.value }))} className="rounded-2xl" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={addPatientCost} className="rounded-2xl">Save Entry</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Patient</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {patientCosts.map((cost) => (
                          <TableRow key={cost.id}>
                            <TableCell className="font-medium">{cost.patientName}</TableCell>
                            <TableCell>{providers.find((p) => p.id === cost.providerId)?.name}</TableCell>
                            <TableCell>{cost.date}</TableCell>
                            <TableCell>{cost.category}</TableCell>
                            <TableCell>{cost.supplier}</TableCell>
                            <TableCell>{cost.reference}</TableCell>
                            <TableCell>{fmtCurrency(cost.amount)}</TableCell>
                            <TableCell>{cost.notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="formulas" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Provider Formula Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Service Fee %</Label>
                      <Input
                        type="number"
                        value={selectedProvider.formula.percent}
                        onChange={(e) => updateProviderFormula(selectedProvider.id, "percent", Number(e.target.value) || 0)}
                        className="rounded-2xl"
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        ["deductAdjustments", "Deduct adjustments"],
                        ["deductIncorrectPayments", "Deduct incorrect payments"],
                        ["deductIVFees", "Deduct IV facility fees"],
                        ["deductMerchantFees", "Deduct merchant fees"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => updateProviderFormula(selectedProvider.id, key, !selectedProvider.formula[key])}
                          className={`rounded-2xl border p-3 text-left ${selectedProvider.formula[key] ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
                        >
                          <div className="font-medium">{label}</div>
                          <div className={`text-sm ${selectedProvider.formula[key] ? "text-slate-300" : "text-slate-500"}`}>
                            {selectedProvider.formula[key] ? "Included in deductions" : "Excluded from formula"}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div>
                      <Label className="mb-2 block">Custom categories included in formula</Label>
                      <div className="space-y-2">
                        {categories.map((category) => {
                          const selected = selectedProvider.formula.includedCustomCategoryIds.includes(category.id);
                          return (
                            <button
                              key={category.id}
                              onClick={() => {
                                const next = selected
                                  ? selectedProvider.formula.includedCustomCategoryIds.filter((id) => id !== category.id)
                                  : [...selectedProvider.formula.includedCustomCategoryIds, category.id];
                                updateProviderFormula(selectedProvider.id, "includedCustomCategoryIds", next);
                              }}
                              className={`flex w-full items-center justify-between rounded-2xl border p-3 ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
                            >
                              <span>{category.name}</span>
                              <Badge variant={selected ? "secondary" : "outline"}>{category.type}</Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Custom Category Builder</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                      <Input
                        placeholder="New category name"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        className="rounded-2xl"
                      />
                      <Select value={newCategoryType} onValueChange={setNewCategoryType}>
                        <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deduction">Deduction</SelectItem>
                          <SelectItem value="addition">Addition</SelectItem>
                          <SelectItem value="retained">Retained by practice</SelectItem>
                          <SelectItem value="info">Informational</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button onClick={addCategory} className="rounded-2xl">Add</Button>
                    </div>

                    <div className="space-y-3">
                      {categories.map((category) => (
                        <div key={category.id} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3">
                          <div>
                            <div className="font-medium">{category.name}</div>
                            <div className="text-sm text-slate-500">ID: {category.id}</div>
                          </div>
                          <Badge variant="outline">{category.type}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="exports" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "Excel Workbook",
                    text: "Summary tab, provider tabs, patient cost register, and calculation audit.",
                    button: "Export Workbook",
                    icon: FileSpreadsheet,
                  },
                  {
                    title: "Provider Statement PDF",
                    text: "Monthly service fee statement with gross, deductions, fee base, and payable amount.",
                    button: "Generate PDFs",
                    icon: FileText,
                  },
                  {
                    title: "Month Lock",
                    text: "Freeze the billing period once reviewed and approved.",
                    button: "Lock Period",
                    icon: AlertTriangle,
                  },
                ].map((item) => (
                  <Card key={item.title} className="rounded-3xl border-0 shadow-sm">
                    <CardContent className="p-5">
                      <div className="mb-4 inline-flex rounded-2xl bg-slate-100 p-3">
                        <item.icon className="h-5 w-5 text-slate-700" />
                      </div>
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm text-slate-600">{item.text}</p>
                      <Button className="mt-4 rounded-2xl" variant={item.title === "Month Lock" ? "outline" : "default"}>{item.button}</Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="rounded-3xl border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Statement Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-3xl border border-slate-200 bg-white p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xl font-semibold">Service Fee Statement</div>
                        <div className="text-sm text-slate-500">{period}</div>
                      </div>
                      <Badge variant="outline">Draft</Badge>
                    </div>
                    <div className="mt-6 grid gap-6 md:grid-cols-2">
                      <div>
                        <div className="text-sm text-slate-500">Provider</div>
                        <div className="font-medium">{selectedProvider.name}</div>
                        <div className="text-sm text-slate-600">{selectedProvider.specialty}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Service Fee %</div>
                        <div className="font-medium">{selectedProvider.formula.percent}%</div>
                      </div>
                    </div>
                    <div className="mt-6 space-y-2 text-sm">
                      <SummaryRow label="Gross Production" value={fmtCurrency(selectedProvider.monthly.grossProduction)} />
                      <SummaryRow label="Less deductions" value={fmtCurrency((selectedProvider.monthly.adjustments || 0) + (selectedProvider.monthly.incorrectPayments || 0) + (selectedProvider.monthly.ivFacilityFees || 0) + (selectedCalc?.costTotal || 0) + (selectedCalc?.merchantFees || 0) + (selectedCalc?.includedCustom || 0))} />
                      <SummaryRow label="Fee Base" value={fmtCurrency(selectedCalc?.feeBase || 0)} strong />
                      <SummaryRow label="Service Fee Payable" value={fmtCurrency(selectedCalc?.serviceFee || 0)} strong />
                      <SummaryRow label="IV Facility Fees retained by practice" value={fmtCurrency(selectedCalc?.practiceRetained || 0)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</span>
      <span className={strong ? "font-semibold text-slate-900" : "text-slate-900"}>{value}</span>
    </div>
  );
}

export default App;
