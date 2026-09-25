import { Check, Scissors } from "lucide-react";
import { Link, Route, Switch } from "wouter";
import { PRODUCT_NAME } from "@shared/const";
import { trpc } from "@/lib/trpc";
import { formatPlanPrice } from "@/lib/formatPlanPrice";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { legalConfig } from "./legalConfig";

export const PUBLIC_PATHS = ["/pricing", "/terms", "/privacy", "/refunds"];

function PublicShell({ children }: { children: React.ReactNode }) {
  const { isArabic, toggleLanguage } = useLanguage();
  return <div className="min-h-[100dvh] bg-stone-50">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/pricing" className="flex items-center gap-2 font-semibold"><Scissors className="h-5 w-5 text-primary" />{PRODUCT_NAME}</Link>
        <div className="flex items-center gap-2">
          <Button data-no-translate variant="ghost" size="sm" onClick={toggleLanguage}>{isArabic ? "EN" : "عربي"}</Button>
          <Link href="/" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Sign in</Link>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
    <footer className="border-t bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
        <Link href="/pricing" className="hover:underline">Pricing</Link>
        <Link href="/terms" className="hover:underline">Terms of service</Link>
        <Link href="/privacy" className="hover:underline">Privacy policy</Link>
        <Link href="/refunds" className="hover:underline">Refund policy</Link>
        <span className="ml-auto" data-no-translate>© {new Date().getFullYear()} {legalConfig.legalBusinessName}</span>
      </div>
    </footer>
  </div>;
}

function Pricing() {
  const { isArabic } = useLanguage();
  const plan = trpc.billing.plan.useQuery();
  const price = plan.data?.price ? formatPlanPrice(plan.data.price, isArabic ? "ar" : "en") : null;
  const features = [
    "Point of sale with offline mode",
    "Customers, measurements and tailoring orders",
    "Inventory and fabric roll tracking",
    "Invoices with VAT, payments and balances",
    "Staff roles, attendance and payroll",
    "Arabic and English, on phone, tablet and desktop",
  ];
  return <div className="space-y-8">
    <div className="text-center">
      <h1 className="text-3xl font-semibold sm:text-4xl">Simple pricing for your tailoring shop</h1>
      <p className="mt-3 text-muted-foreground">One plan with everything included. Cancel anytime.</p>
    </div>
    <div className="mx-auto max-w-md rounded-2xl border bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">{PRODUCT_NAME}</p>
      {price ? <p className="mt-3"><span className="numeric text-4xl font-semibold" data-no-translate>{price.amount}</span> <span className="text-muted-foreground">per {price.period}</span></p> : <p className="mt-3 text-muted-foreground">Contact us for pricing.</p>}
      {plan.data?.billingEnabled && plan.data.trialDays > 0 && <p className="mt-2 text-sm text-emerald-700">{`${plan.data.trialDays}-day free trial, no card required`}</p>}
      <ul className="mt-6 space-y-2 text-sm">{features.map(feature => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
      <Link href="/" className="mt-6 block rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground">Create your shop</Link>
      <p className="mt-3 text-center text-xs text-muted-foreground">Prices exclude applicable taxes, which are calculated at checkout. Payments are processed by Paddle.com, our reseller and merchant of record.</p>
    </div>
  </div>;
}

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="prose prose-stone max-w-none space-y-4 text-sm leading-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold">
    <h1 className="text-3xl font-semibold">{title}</h1>
    <p className="text-muted-foreground" data-no-translate>Last updated: {legalConfig.lastUpdated}</p>
    {children}
  </article>;
}

// These are starting templates, not legal advice: review them (ideally with
// a lawyer) and fill in legalConfig.ts before going live.
function Terms() {
  const c = legalConfig;
  return <LegalPage title="Terms of service">
    <p data-no-translate>These terms govern your use of {PRODUCT_NAME} (the "Service"), provided by {c.legalBusinessName}, {c.businessAddress} ("we", "us"). By creating an account you agree to them.</p>
    <h2>The Service</h2>
    <p>The Service is web-based business software for tailoring shops: point of sale, customer and order management, inventory, invoicing and staff management. We may improve or change features over time.</p>
    <h2>Accounts</h2>
    <p>You are responsible for your account, for the staff you invite and for keeping passwords secure. You must provide accurate information and be authorized to act for the business you register.</p>
    <h2>Free trial and subscription</h2>
    <p>New shops start with a free trial. After the trial, continued use requires a paid subscription, billed in advance for each billing period until cancelled. If the trial ends or a payment fails, your workspace becomes read-only: you can still sign in, view and export your data, but cannot record new activity until a subscription is active.</p>
    <h2>Payments</h2>
    <p data-no-translate>Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns related to payments.</p>
    <h2>Cancellation</h2>
    <p>You can cancel at any time from the billing page. Cancellation takes effect at the end of the current billing period. See our refund policy for refunds.</p>
    <h2>Your data</h2>
    <p>You own the business data you enter. We process it only to provide the Service, as described in our privacy policy. You can export your data while your account is active or read-only.</p>
    <h2>Acceptable use</h2>
    <p>Do not misuse the Service, attempt to access other customers' data, interfere with its operation, or use it for unlawful purposes. We may suspend accounts that do.</p>
    <h2>Liability</h2>
    <p>The Service is provided "as is". To the extent permitted by law, our total liability is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses.</p>
    <h2>Changes and contact</h2>
    <p data-no-translate>We may update these terms and will notify you of material changes. These terms are governed by the laws of {c.governingLaw}. Questions: {c.supportEmail}.</p>
  </LegalPage>;
}

function Privacy() {
  const c = legalConfig;
  return <LegalPage title="Privacy policy">
    <p data-no-translate>{c.legalBusinessName} ("we") operates {PRODUCT_NAME}. This policy explains what personal data we process and why.</p>
    <h2>What we collect</h2>
    <p>Account data (name, email, hashed password); business data you enter (customers, measurements, orders, sales, invoices, staff records and documents); and technical data (IP address, device and log information) needed to run and secure the Service.</p>
    <h2>How we use it</h2>
    <p>To provide and secure the Service, send transactional emails (such as password resets and staff invites), provide support, and meet legal obligations. We do not sell personal data.</p>
    <h2>Your customers' data</h2>
    <p>For personal data about your own customers and staff, you are the controller and we process it on your behalf, only to provide the Service.</p>
    <h2>Service providers</h2>
    <p>We use trusted providers to run the Service: cloud hosting and database, file storage, email delivery, error monitoring, and Paddle for payments (Paddle processes billing details as merchant of record under its own privacy policy).</p>
    <h2>Retention and security</h2>
    <p>We keep data while your account is active and for a limited period afterwards, unless the law requires longer. Data is encrypted in transit, passwords are hashed, and each shop's data is isolated from other shops.</p>
    <h2>Your rights</h2>
    <p data-no-translate>Depending on where you live, you may request access to, correction of, export of or deletion of your personal data. Contact {c.supportEmail}.</p>
  </LegalPage>;
}

function Refunds() {
  const c = legalConfig;
  return <LegalPage title="Refund policy">
    <p>Every new shop gets a free trial, so you can evaluate the Service before paying.</p>
    <p data-no-translate>If you are not satisfied with a paid subscription, you may request a full refund within {c.refundWindowDays} days of your first payment. After that, you can cancel at any time and you will keep access until the end of the period you have paid for; partial periods are not refunded.</p>
    <p data-no-translate>Refunds are processed by Paddle, our merchant of record. To request one, contact {c.supportEmail} or use the link in your Paddle receipt.</p>
  </LegalPage>;
}

export default function PublicPages() {
  return <PublicShell>
    <Switch>
      <Route path="/pricing" component={Pricing} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/refunds" component={Refunds} />
    </Switch>
  </PublicShell>;
}
