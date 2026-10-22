import { Check, Scissors } from "lucide-react";
import { Link, Route, Switch } from "wouter";
import { BOOK_DEMO_URL, COMPANY_NAME, COMPANY_URL, MARKETING_SITE_URL, PRODUCT_NAME, PRODUCT_NAME_AR } from "@shared/const";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { legalConfig } from "./legalConfig";

export const PUBLIC_PATHS = ["/pricing", "/terms", "/privacy"];

function PublicShell({ children }: { children: React.ReactNode }) {
  const { isArabic, toggleLanguage } = useLanguage();
  return <div className="min-h-[100dvh] bg-background">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
        <a href={MARKETING_SITE_URL} className="flex items-center gap-2 font-semibold"><Scissors className="h-5 w-5 text-primary" /><span className="leading-tight">{PRODUCT_NAME}<span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-no-translate>powered by {COMPANY_NAME}</span></span></a>
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
        <span className="ml-auto" data-no-translate>© {new Date().getFullYear()} {PRODUCT_NAME}, powered by <a href={COMPANY_URL} target="_blank" rel="noopener" className="font-medium hover:underline">{COMPANY_NAME}</a></span>
      </div>
    </footer>
  </div>;
}

function Pricing() {
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
      <h1 className="text-3xl font-semibold sm:text-4xl">Pricing that fits your shop</h1>
      <p className="mt-3 text-muted-foreground">Every plan includes the full system, setup and support. Your price depends on your branches and team, and is set out in your service agreement.</p>
    </div>
    <div className="mx-auto max-w-md rounded-2xl border bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">{PRODUCT_NAME}</p>
      <p className="mt-3 text-muted-foreground">Book a demo and we will send you a quote.</p>
      <ul className="mt-6 space-y-2 text-sm">{features.map(feature => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
      <a href={BOOK_DEMO_URL} className="mt-6 block rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground">Book a demo</a>
    </div>
  </div>;
}

/**
 * Legal pages carry both languages in full (data-no-translate), rather than
 * going through the UI string table, so each paragraph reads as one piece and
 * the values from legalConfig sit inside the sentence in either language.
 */
function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const { isArabic } = useLanguage();
  return <article data-no-translate className="prose prose-stone max-w-none space-y-4 text-sm leading-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold">
    <h1 className="text-3xl font-semibold">{title}</h1>
    <p className="text-muted-foreground">{isArabic ? "آخر تحديث" : "Last updated"}: {legalConfig.lastUpdated}</p>
    {children}
  </article>;
}

// Starting templates, not legal advice: review them (ideally with a lawyer)
// and fill in legalConfig.ts before going live. Where a customer has signed a
// service agreement, that agreement prevails.
function Terms() {
  const { isArabic } = useLanguage();
  const c = legalConfig;
  if (isArabic) return <LegalPage title="شروط الخدمة">
    <p>تحكم هذه الشروط استخدامك لمنصة «{PRODUCT_NAME_AR}» ("الخدمة") المقدَّمة من {c.legalBusinessName}، {c.businessAddress} ("نحن"). إذا كانت لديك اتفاقية خدمة موقّعة معنا، فإن تلك الاتفاقية هي المرجع، وتسري أحكامها عند أي تعارض مع هذه الشروط.</p>
    <h2>الخدمة</h2>
    <p>الخدمة برنامج أعمال عبر الإنترنت لمحلات الخياطة: نقطة بيع، وإدارة العملاء والطلبات، والمخزون، والفوترة، وإدارة الموظفين. قد نحسّن الميزات أو نغيّرها مع الوقت.</p>
    <h2>الحسابات والوصول</h2>
    <p>ننشئ حساب متجرك بعد توقيع اتفاقية الخدمة. أنت مسؤول عن حسابك وعن الموظفين الذين تدعوهم وعن الحفاظ على سرية كلمات المرور، ويجب أن تكون مخوّلًا بالتصرف نيابة عن المتجر.</p>
    <h2>الرسوم والدفع</h2>
    <p>الرسوم ومدة الاشتراك وشروط الدفع محددة في اتفاقية الخدمة الخاصة بك. نصدر الفواتير وفقًا لتلك الاتفاقية. يجوز لنا، بعد إشعارك، تعليق الوصول إذا تأخر سداد فاتورة مستحقة، مع بقاء بياناتك محفوظة.</p>
    <h2>المدة والإنهاء</h2>
    <p>تسري الخدمة طوال المدة المحددة في اتفاقيتك. عند انتهائها، يمكنك طلب نسخة من بياناتك خلال 30 يومًا، وبعدها قد نحذفها.</p>
    <h2>بياناتك</h2>
    <p>أنت مالك بيانات العمل التي تدخلها. نعالجها فقط لتقديم الخدمة، كما هو موضح في سياسة الخصوصية.</p>
    <h2>الاستخدام المقبول</h2>
    <p>لا تُسئ استخدام الخدمة، ولا تحاول الوصول إلى بيانات عملاء آخرين أو تعطيل تشغيلها أو استخدامها لأغراض غير مشروعة. يجوز لنا تعليق الحسابات المخالفة.</p>
    <h2>المسؤولية</h2>
    <p>تُقدَّم الخدمة "كما هي". وإلى الحد الذي يسمح به القانون، تقتصر مسؤوليتنا الإجمالية على المبالغ التي دفعتها لنا خلال الأشهر الاثني عشر السابقة للمطالبة، ولا نتحمل مسؤولية الخسائر غير المباشرة أو التبعية.</p>
    <h2>التعديلات والتواصل</h2>
    <p>قد نحدّث هذه الشروط وسنبلغك بأي تغييرات جوهرية. تخضع هذه الشروط لقوانين {c.governingLaw}. للاستفسارات: {c.supportEmail}.</p>
  </LegalPage>;
  return <LegalPage title="Terms of service">
    <p>These terms govern your use of {PRODUCT_NAME} (the "Service"), provided by {c.legalBusinessName}, {c.businessAddress} ("we", "us"). If you have signed a service agreement with us, that agreement governs and prevails over these terms where they differ.</p>
    <h2>The Service</h2>
    <p>The Service is web-based business software for tailoring shops: point of sale, customer and order management, inventory, invoicing and staff management. We may improve or change features over time.</p>
    <h2>Accounts and access</h2>
    <p>We create your shop's account once a service agreement is signed. You are responsible for your account, for the staff you invite and for keeping passwords secure, and you must be authorized to act for the business.</p>
    <h2>Fees and payment</h2>
    <p>Fees, the subscription term and payment terms are set out in your service agreement, and we invoice according to it. After giving you notice, we may suspend access while an invoice is overdue; your data is kept.</p>
    <h2>Term and termination</h2>
    <p>The Service runs for the term in your agreement. When it ends, you can request an export of your data within 30 days, after which we may delete it.</p>
    <h2>Your data</h2>
    <p>You own the business data you enter. We process it only to provide the Service, as described in our privacy policy.</p>
    <h2>Acceptable use</h2>
    <p>Do not misuse the Service, attempt to access other customers' data, interfere with its operation, or use it for unlawful purposes. We may suspend accounts that do.</p>
    <h2>Liability</h2>
    <p>The Service is provided "as is". To the extent permitted by law, our total liability is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses.</p>
    <h2>Changes and contact</h2>
    <p>We may update these terms and will notify you of material changes. These terms are governed by the laws of {c.governingLaw}. Questions: {c.supportEmail}.</p>
  </LegalPage>;
}

function Privacy() {
  const { isArabic } = useLanguage();
  const c = legalConfig;
  if (isArabic) return <LegalPage title="سياسة الخصوصية">
    <p>تشغّل {c.legalBusinessName} ("نحن") منصة «{PRODUCT_NAME_AR}». توضح هذه السياسة البيانات الشخصية التي نعالجها وسبب ذلك.</p>
    <h2>ما نجمعه</h2>
    <p>بيانات الحساب (الاسم، البريد الإلكتروني، كلمة المرور بصيغة مشفّرة)؛ وبيانات العمل التي تدخلها (العملاء، المقاسات، الطلبات، المبيعات، الفواتير، سجلات الموظفين ومستنداتهم)؛ والبيانات التقنية (عنوان IP ومعلومات الجهاز والسجلات) اللازمة لتشغيل الخدمة وحمايتها. وعند طلب عرض توضيحي من موقعنا، نحتفظ بالبيانات التي ترسلها (الاسم، اسم المتجر، البريد الإلكتروني، الهاتف، الرسالة) للتواصل معك.</p>
    <h2>كيف نستخدمها</h2>
    <p>لتقديم الخدمة وحمايتها، وإرسال رسائل البريد اللازمة (مثل إعادة تعيين كلمة المرور ودعوات الموظفين)، وتقديم الدعم، والوفاء بالالتزامات القانونية. لا نبيع البيانات الشخصية.</p>
    <h2>بيانات عملائك</h2>
    <p>بالنسبة للبيانات الشخصية الخاصة بعملائك وموظفيك، فأنت المتحكم بها، ونحن نعالجها نيابة عنك لتقديم الخدمة فقط.</p>
    <h2>مزودو الخدمة</h2>
    <p>نستعين بمزودين موثوقين لتشغيل الخدمة: الاستضافة السحابية وقاعدة البيانات، وتخزين الملفات، وإرسال البريد الإلكتروني، ومراقبة الأخطاء. لا نخزّن بيانات البطاقات المصرفية.</p>
    <h2>الاحتفاظ والأمان</h2>
    <p>نحتفظ بالبيانات طوال مدة نشاط حسابك ولفترة محدودة بعدها، ما لم يتطلب القانون مدة أطول. البيانات مشفّرة أثناء النقل، وكلمات المرور مشفّرة، وبيانات كل متجر معزولة عن غيره.</p>
    <h2>حقوقك</h2>
    <p>بحسب مكان إقامتك، يمكنك طلب الاطلاع على بياناتك الشخصية أو تصحيحها أو تصديرها أو حذفها. تواصل معنا عبر {c.supportEmail}.</p>
  </LegalPage>;
  return <LegalPage title="Privacy policy">
    <p>{c.legalBusinessName} ("we") operates {PRODUCT_NAME}. This policy explains what personal data we process and why.</p>
    <h2>What we collect</h2>
    <p>Account data (name, email, hashed password); business data you enter (customers, measurements, orders, sales, invoices, staff records and documents); and technical data (IP address, device and log information) needed to run and secure the Service. When you request a demo on our website, we keep the details you send (name, shop name, email, phone, message) to contact you.</p>
    <h2>How we use it</h2>
    <p>To provide and secure the Service, send transactional emails (such as password resets and staff invites), provide support, and meet legal obligations. We do not sell personal data.</p>
    <h2>Your customers' data</h2>
    <p>For personal data about your own customers and staff, you are the controller and we process it on your behalf, only to provide the Service.</p>
    <h2>Service providers</h2>
    <p>We use trusted providers to run the Service: cloud hosting and database, file storage, email delivery and error monitoring. We do not store payment card details.</p>
    <h2>Retention and security</h2>
    <p>We keep data while your account is active and for a limited period afterwards, unless the law requires longer. Data is encrypted in transit, passwords are hashed, and each shop's data is isolated from other shops.</p>
    <h2>Your rights</h2>
    <p>Depending on where you live, you may request access to, correction of, export of or deletion of your personal data. Contact {c.supportEmail}.</p>
  </LegalPage>;
}

export default function PublicPages() {
  return <PublicShell>
    <Switch>
      <Route path="/pricing" component={Pricing} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
    </Switch>
  </PublicShell>;
}
