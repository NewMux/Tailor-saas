import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { initializePaddle } from "@paddle/paddle-js";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Check,
  FileText,
  Languages,
  Receipt,
  Scissors,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientBrand } from "@/lib/branding";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";

type Copy = { en: string; ar: string };

const COPY = {
  signIn: { en: "Sign in", ar: "تسجيل الدخول" },
  startTrial: { en: "Start free trial", ar: "ابدأ التجربة المجانية" },
  heroTitle: {
    en: "Run your tailoring business, not your paperwork",
    ar: "أدر أعمال الخياطة، لا الأوراق",
  },
  heroSubtitle: {
    en: "The complete workspace for thoub and abaya tailors across the GCC — measurements, orders, point of sale, VAT invoices and payroll in one place, in Arabic and English.",
    ar: "منصة متكاملة لمحلات خياطة الثياب والعبايات في دول الخليج — المقاسات والطلبات ونقطة البيع وفواتير الضريبة والرواتب في مكان واحد، بالعربية والإنجليزية.",
  },
  noCard: { en: "No credit card required", ar: "بدون بطاقة ائتمان" },
  cancelAnytime: { en: "Cancel anytime", ar: "إلغاء في أي وقت" },
  featuresTitle: {
    en: "Everything a tailoring shop actually needs",
    ar: "كل ما يحتاجه محل الخياطة فعلياً",
  },
  featuresSubtitle: {
    en: "Built with tailors in the Gulf, around how the work really happens on the shop floor.",
    ar: "طُوّر مع خياطين في الخليج، وفق سير العمل الحقيقي داخل المحل.",
  },
  pricingTitle: {
    en: "One plan. Everything included.",
    ar: "خطة واحدة. كل المزايا.",
  },
  pricingSubtitle: {
    en: "No per-user fees and no setup charges. Try it free, then keep going if it earns its place.",
    ar: "بدون رسوم لكل مستخدم ولا رسوم تأسيس. جرّبه مجاناً، ثم استمر إذا أثبت جدواه.",
  },
  perMonth: { en: "per month", ar: "شهرياً" },
  freeTrialBadge: { en: "day free trial", ar: "يوم تجربة مجانية" },
  ctaTitle: {
    en: "Ready to open your workspace?",
    ar: "جاهز لفتح مساحة عملك؟",
  },
  ctaSubtitle: {
    en: "Set up your shop in minutes. Your data stays yours, and you can export it whenever you want.",
    ar: "جهّز محلك خلال دقائق. بياناتك ملكك، ويمكنك تصديرها متى شئت.",
  },
  vatNote: {
    en: "VAT-ready invoicing for Bahrain, Saudi Arabia, the UAE, Oman and Qatar.",
    ar: "فوترة جاهزة للضريبة في البحرين والسعودية والإمارات وعُمان وقطر.",
  },
  rights: { en: "All rights reserved.", ar: "جميع الحقوق محفوظة." },
} satisfies Record<string, Copy>;

const FEATURES: Array<{ icon: typeof Scissors; title: Copy; body: Copy }> = [
  {
    icon: Users,
    title: { en: "Customer measurements", ar: "مقاسات العملاء" },
    body: {
      en: "Every customer's measurements kept with full version history, so last year's thoub can be repeated exactly.",
      ar: "مقاسات كل عميل محفوظة مع سجل كامل للتعديلات، لتكرار ثوب العام الماضي بنفس الدقة.",
    },
  },
  {
    icon: Scissors,
    title: { en: "Tailoring orders", ar: "طلبات التفصيل" },
    body: {
      en: "Track each order from cutting to stitching to fitting to handover, with the tailor and due date on every job.",
      ar: "تابع كل طلب من القص إلى الخياطة إلى القياس إلى التسليم، مع الخياط وتاريخ التسليم لكل عمل.",
    },
  },
  {
    icon: Receipt,
    title: { en: "Point of sale", ar: "نقطة البيع" },
    body: {
      en: "Fast counter checkout with cash, card, BenefitPay and bank transfer, plus held orders and returns.",
      ar: "بيع سريع عند الكاونتر نقداً أو بالبطاقة أو بنفت باي أو تحويل بنكي، مع الطلبات المعلقة والمرتجعات.",
    },
  },
  {
    icon: Boxes,
    title: { en: "Fabric & stock control", ar: "إدارة الأقمشة والمخزون" },
    body: {
      en: "Fabric tracked by the metre and by the roll, with low-stock alerts before you run out mid-order.",
      ar: "تتبع القماش بالمتر وباللفة، مع تنبيهات نفاد المخزون قبل توقف الطلبات.",
    },
  },
  {
    icon: FileText,
    title: { en: "VAT invoices", ar: "فواتير ضريبية" },
    body: {
      en: "Bilingual invoices with your CR and VAT number, part payments and a full payment ledger per customer.",
      ar: "فواتير ثنائية اللغة برقم السجل التجاري والرقم الضريبي، مع الدفعات الجزئية وسجل كامل لكل عميل.",
    },
  },
  {
    icon: Banknote,
    title: { en: "Staff & payroll", ar: "الموظفون والرواتب" },
    body: {
      en: "Attendance, commissions, deductions and payslips for your tailors and counter staff.",
      ar: "الحضور والعمولات والخصومات وقسائم الرواتب للخياطين وموظفي الكاونتر.",
    },
  },
];

const DIFFERENTIATORS: Array<{
  icon: typeof Languages;
  title: Copy;
  body: Copy;
}> = [
  {
    icon: Languages,
    title: { en: "Arabic and English", ar: "بالعربية والإنجليزية" },
    body: {
      en: "Full right-to-left Arabic interface, switchable per user at any time.",
      ar: "واجهة عربية كاملة من اليمين لليسار، قابلة للتبديل لكل مستخدم.",
    },
  },
  {
    icon: WifiOff,
    title: { en: "Keeps selling offline", ar: "يعمل دون إنترنت" },
    body: {
      en: "Counter sales continue during an internet outage and sync automatically once it returns.",
      ar: "تستمر مبيعات الكاونتر أثناء انقطاع الإنترنت وتتم المزامنة تلقائياً عند عودته.",
    },
  },
  {
    icon: Smartphone,
    title: { en: "Works on any device", ar: "يعمل على أي جهاز" },
    body: {
      en: "Use it on the shop counter tablet, an office desktop, or your phone while you travel.",
      ar: "استخدمه على جهاز الكاونتر أو حاسب المكتب أو هاتفك أثناء السفر.",
    },
  },
  {
    icon: ShieldCheck,
    title: { en: "Your data stays yours", ar: "بياناتك ملكك" },
    body: {
      en: "Each shop's data is isolated from every other shop, and exports are always available to you.",
      ar: "بيانات كل محل معزولة تماماً عن غيره، والتصدير متاح لك دائماً.",
    },
  },
];

const PLAN_INCLUDES: Copy[] = [
  {
    en: "Unlimited customers and measurement profiles",
    ar: "عملاء ومقاسات بلا حدود",
  },
  {
    en: "Unlimited tailoring orders and invoices",
    ar: "طلبات تفصيل وفواتير بلا حدود",
  },
  { en: "Point of sale with offline mode", ar: "نقطة بيع مع وضع عدم الاتصال" },
  { en: "Fabric and stock control", ar: "إدارة الأقمشة والمخزون" },
  {
    en: "Staff accounts with custom roles",
    ar: "حسابات موظفين بصلاحيات مخصصة",
  },
  {
    en: "Attendance, commissions and payslips",
    ar: "الحضور والعمولات وقسائم الرواتب",
  },
  {
    en: "VAT-ready bilingual invoicing",
    ar: "فوترة ثنائية اللغة جاهزة للضريبة",
  },
  { en: "Arabic and English interface", ar: "واجهة عربية وإنجليزية" },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { isArabic, toggleLanguage } = useLanguage();
  const planQuery = trpc.billing.publicPlan.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [localizedPrice, setLocalizedPrice] = useState<string | null>(null);

  const text = (copy: Copy) => (isArabic ? copy.ar : copy.en);
  const Arrow = isArabic ? ArrowLeft : ArrowRight;
  const plan = planQuery.data;

  /**
   * Asks Paddle for a price localized to the visitor's country, so a shop
   * owner in Riyadh sees SAR and one in Dubai sees AED. Any failure here is
   * non-fatal: the env-configured fallback price is shown instead.
   */
  useEffect(() => {
    if (!plan?.configured || !plan.clientToken || !plan.priceId) return;
    let cancelled = false;

    void (async () => {
      try {
        const paddle = await initializePaddle({
          token: plan.clientToken,
          environment:
            plan.environment === "production" ? "production" : "sandbox",
        });
        if (!paddle || cancelled) return;
        const preview = await paddle.PricePreview({
          items: [{ priceId: plan.priceId, quantity: 1 }],
        });
        const formatted =
          preview.data.details.lineItems[0]?.formattedTotals.subtotal;
        if (formatted && !cancelled) setLocalizedPrice(formatted);
      } catch {
        // Fall back to the configured display price.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan?.configured, plan?.clientToken, plan?.priceId, plan?.environment]);

  const priceLabel =
    localizedPrice ??
    `${plan?.displayCurrency ?? "USD"} ${plan?.displayPrice ?? "29"}`;
  const trialDays = plan?.trialDays ?? 14;

  return (
    <div
      className="min-h-[100dvh] bg-white text-stone-900"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white shadow-sm">
              <img
                src={clientBrand.logoSrc}
                alt={clientBrand.logoAlt}
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-lg font-semibold">{clientBrand.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              className="gap-1.5"
            >
              <Languages className="h-4 w-4" />
              {isArabic ? "English" : "العربية"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/login")}
            >
              {text(COPY.signIn)}
            </Button>
            <Button size="sm" onClick={() => navigate("/signup")}>
              {text(COPY.startTrial)}
            </Button>
          </div>
        </div>
      </header>

      <section className="border-b bg-gradient-to-b from-stone-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
              <BadgeCheck className="h-3.5 w-3.5" />
              {text({
                en: "Made for tailoring shops in the GCC",
                ar: "مصمم لمحلات الخياطة في دول الخليج",
              })}
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {text(COPY.heroTitle)}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-stone-600">
              {text(COPY.heroSubtitle)}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="w-full gap-2 sm:w-auto"
                onClick={() => navigate("/signup")}
              >
                {text(COPY.startTrial)}
                <Arrow className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => navigate("/login")}
              >
                {text(COPY.signIn)}
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-600" />
                {trialDays} {text(COPY.freeTrialBadge)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-600" />
                {text(COPY.noCard)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-600" />
                {text(COPY.cancelAnytime)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            {text(COPY.featuresTitle)}
          </h2>
          <p className="mt-3 text-stone-600">{text(COPY.featuresSubtitle)}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(feature => (
            <div
              key={feature.title.en}
              className="rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-stone-900 text-white">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{text(feature.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {text(feature.body)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-stone-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {DIFFERENTIATORS.map(item => (
              <div key={item.title.en}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-white shadow-sm">
                  <item.icon className="h-5 w-5 text-stone-900" />
                </div>
                <h3 className="mt-4 font-semibold">{text(item.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">
                  {text(item.body)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20"
      >
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            {text(COPY.pricingTitle)}
          </h2>
          <p className="mt-3 text-stone-600">{text(COPY.pricingSubtitle)}</p>
        </div>

        <div className="mx-auto mt-10 max-w-lg rounded-3xl border-2 border-stone-900 bg-white p-8 shadow-lg">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-4xl font-bold tracking-tight">
              {priceLabel}
            </span>
            <span className="text-stone-500">/ {text(COPY.perMonth)}</span>
          </div>
          <p className="mt-2 text-center text-sm font-medium text-emerald-700">
            {trialDays} {text(COPY.freeTrialBadge)} · {text(COPY.noCard)}
          </p>

          <ul className="mt-8 space-y-3">
            {PLAN_INCLUDES.map(item => (
              <li key={item.en} className="flex items-start gap-3 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{text(item)}</span>
              </li>
            ))}
          </ul>

          <Button
            size="lg"
            className="mt-8 w-full gap-2"
            onClick={() => navigate("/signup")}
          >
            {text(COPY.startTrial)}
            <Arrow className="h-4 w-4" />
          </Button>
          <p className="mt-4 text-center text-xs text-stone-500">
            {text(COPY.vatNote)}
          </p>
        </div>
      </section>

      <section className="border-t bg-stone-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">
            {text(COPY.ctaTitle)}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-stone-300">
            {text(COPY.ctaSubtitle)}
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="mt-8 gap-2"
            onClick={() => navigate("/signup")}
          >
            {text(COPY.startTrial)}
            <Arrow className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:px-6">
          <span>
            © {new Date().getFullYear()} {clientBrand.name}.{" "}
            {text(COPY.rights)}
          </span>
          <span>{text(COPY.vatNote)}</span>
        </div>
      </footer>
    </div>
  );
}
