import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { clientBrand } from "@/lib/branding";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  BadgeCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ReceiptText,
  Scissors,
  ShieldCheck,
  ShoppingCart,
  Users,
  WifiOff,
} from "lucide-react";

const features = [
  {
    icon: ShoppingCart,
    title: "Point of Sale",
    description: "Fast in-store checkout with barcode/inventory lookup, discounts, and offline-capable sales that sync automatically once you're back online.",
  },
  {
    icon: Scissors,
    title: "Tailoring order management",
    description: "Track custom orders from measurement to delivery, with statuses, due dates, and customer measurement profiles kept on file.",
  },
  {
    icon: Package,
    title: "Inventory & stock control",
    description: "Real-time stock levels across fabric, supplies, and finished goods, with full stock-movement history.",
  },
  {
    icon: ReceiptText,
    title: "Sales history & reporting",
    description: "A complete, searchable record of every sale and payment, so you always know what's moving and what isn't.",
  },
  {
    icon: FileText,
    title: "Invoicing",
    description: "Generate and track customer invoices and payments, including partial payments and delivery status.",
  },
  {
    icon: Users,
    title: "Staff & payroll",
    description: "Role-based staff accounts, attendance, performance records, and salary payouts — all in one workspace.",
  },
  {
    icon: ClipboardList,
    title: "Audit trail",
    description: "Every important action is logged, so owners always have a clear record of who did what and when.",
  },
  {
    icon: WifiOff,
    title: "Works offline",
    description: "The point-of-sale keeps working even when the internet drops, and syncs the moment connectivity returns.",
  },
];

const steps = [
  { title: "Book a demo", description: "Tell us about your shop and we'll walk you through the system live, on a call." },
  { title: "Sign & set up", description: "Like what you see? A one-time setup fee and a simple contract get your shop fully configured." },
  { title: "Go live", description: "Your team starts using the ERP day-to-day, backed by an ongoing monthly subscription." },
];

function buildDemoRequestMailto(fields: { name: string; shopName: string; email: string; phone: string; message: string }) {
  const subject = `Demo request: ${fields.shopName || fields.name}`;
  const bodyLines = [
    `Name: ${fields.name}`,
    `Shop / business name: ${fields.shopName}`,
    `Email: ${fields.email}`,
    fields.phone ? `Phone: ${fields.phone}` : null,
    "",
    fields.message || "(no additional message)",
  ].filter((line): line is string => line !== null);
  const params = new URLSearchParams({ subject, body: bodyLines.join("\n") });
  return `mailto:${clientBrand.salesEmail}?${params.toString()}`;
}

export default function LandingPage() {
  const { isArabic, toggleLanguage } = useLanguage();
  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    window.location.href = buildDemoRequestMailto({ name, shopName, email, phone, message });
  };

  return (
    <div className={`min-h-screen bg-stone-50 ${isArabic ? "text-right" : "text-left"}`}>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white shadow-sm">
              <img src={clientBrand.logoSrc} alt={clientBrand.logoAlt} className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="font-semibold leading-tight">{clientBrand.name}</p>
              <p className="text-xs text-muted-foreground leading-tight">Tailor ERP</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button data-no-translate type="button" variant="outline" size="sm" className="rounded-xl" onClick={toggleLanguage}>
              {isArabic ? "EN" : "عربي"}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Built for tailoring & custom-order businesses
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              The complete ERP for running your tailoring business
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Point of sale, custom orders, inventory, invoicing, staff, and payroll — one workspace, built specifically for tailor shops.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#book-a-demo">
                <Button size="lg" className="w-full sm:w-auto">Book a demo</Button>
              </a>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">Existing customer? Sign in</Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-semibold sm:text-3xl">Everything your shop needs, already built</h2>
              <p className="mt-3 text-muted-foreground">A single system that replaces spreadsheets, notebooks, and disconnected tools.</p>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(feature => {
                const Icon = feature.icon;
                return (
                  <Card key={feature.title} className="border-stone-200">
                    <CardHeader>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="mt-3 text-base">{feature.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{feature.description}</CardDescription>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-semibold sm:text-3xl">How it works</h2>
              <p className="mt-3 text-muted-foreground">No self-service checkout — we set your shop up ourselves so it fits your workflow from day one.</p>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {steps.map((step, index) => (
                <div key={step.title} className="rounded-2xl border bg-white p-6 text-center">
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </div>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <BadgeCheck className="h-4 w-4 text-primary" />
              One-time setup fee, then a simple monthly subscription — no hidden costs.
            </div>
          </div>
        </section>

        <section id="book-a-demo" className="border-t bg-white py-16">
          <div className="mx-auto max-w-xl px-4 sm:px-6">
            <div className="text-center">
              <LayoutDashboard className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">Book a demo</h2>
              <p className="mt-3 text-muted-foreground">Tell us a bit about your shop and we'll set up a call to show you the system live.</p>
            </div>
            <form className="mt-8 space-y-4 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="demo-name">Your name</Label>
                <Input id="demo-name" value={name} onChange={e => setName(e.target.value)} required maxLength={160} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-shop">Shop or business name</Label>
                <Input id="demo-shop" value={shopName} onChange={e => setShopName(e.target.value)} required maxLength={160} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-email">Email</Label>
                <Input id="demo-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={320} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-phone">Phone (optional)</Label>
                <Input id="demo-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-message">What would you like to see? (optional)</Label>
                <Textarea id="demo-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={3} />
              </div>
              <Button type="submit" className="w-full">Request a demo</Button>
              <p className="text-center text-xs text-muted-foreground">
                This opens an email to {clientBrand.salesEmail}. We'll get back to you to schedule a time.
              </p>
            </form>
          </div>
        </section>
      </main>

      <footer className="border-t bg-stone-50 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground sm:px-6">
          <p>{clientBrand.name} Tailor ERP</p>
          <p>
            Already a customer?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in here
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
