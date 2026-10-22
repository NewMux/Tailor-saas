import { PRODUCT_NAME, PRODUCT_NAME_AR } from "@shared/const";
import type { EmailMessage } from "./email";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Section = { heading: string; body: string[]; button?: { label: string; url: string }; footnote?: string };

/**
 * Minimal inline-styled layout (email clients ignore <style> blocks) with an
 * English section followed by an Arabic, right-to-left section, matching the
 * app's bilingual UI.
 */
function layout(english: Section, arabic: Section) {
  const block = (section: Section, dir: "ltr" | "rtl") => `
    <div dir="${dir}" style="text-align:${dir === "rtl" ? "right" : "left"};">
      <h1 style="font-size:20px;margin:0 0 12px;color:#111733;">${escapeHtml(section.heading)}</h1>
      ${section.body.map(p => `<p style="margin:0 0 12px;line-height:1.5;color:#111733;">${escapeHtml(p)}</p>`).join("")}
      ${
        section.button
          ? `<p style="margin:20px 0;"><a href="${escapeHtml(section.button.url)}" style="background:#1E2A5A;color:#F7F4EE;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;">${escapeHtml(section.button.label)}</a></p>`
          : ""
      }
      ${section.footnote ? `<p style="margin:0;font-size:12px;color:#5B6380;">${escapeHtml(section.footnote)}</p>` : ""}
    </div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F7F4EE;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border:1px solid #E8E1D3;border-radius:16px;padding:28px;">
      ${block(english, "ltr")}
      <hr style="border:none;border-top:2px dashed #D4A13A;margin:24px 0;" />
      ${block(arabic, "rtl")}
    </div>
    <p style="text-align:center;font-size:12px;color:#5B6380;margin-top:16px;">${escapeHtml(PRODUCT_NAME)}</p>
  </div></body></html>`;
  const textBlock = (section: Section) =>
    [section.heading, "", ...section.body, section.button ? `${section.button.label}: ${section.button.url}` : "", section.footnote ?? ""]
      .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
      .join("\n");
  const text = `${textBlock(english)}\n\n---\n\n${textBlock(arabic)}\n`;
  return { html, text };
}

export function passwordResetEmail(to: string, resetUrl: string): EmailMessage {
  const { html, text } = layout(
    {
      heading: `Reset your ${PRODUCT_NAME} password`,
      body: ["We received a request to reset the password for your account. This link works once and expires in 1 hour."],
      button: { label: "Choose a new password", url: resetUrl },
      footnote: "If you didn't ask for this, you can ignore this email. Your password won't change.",
    },
    {
      heading: "إعادة تعيين كلمة المرور",
      body: ["تلقينا طلبًا لإعادة تعيين كلمة المرور لحسابك. هذا الرابط يعمل مرة واحدة وتنتهي صلاحيته خلال ساعة."],
      button: { label: "اختيار كلمة مرور جديدة", url: resetUrl },
      footnote: "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة ولن تتغير كلمة المرور.",
    }
  );
  return { to, subject: `Reset your ${PRODUCT_NAME} password`, html, text };
}

export function staffInviteEmail(to: string, input: { inviteeName: string; shopName: string; roleName: string; inviteUrl: string }): EmailMessage {
  const { html, text } = layout(
    {
      heading: `You're invited to join ${input.shopName}`,
      body: [
        `Hi ${input.inviteeName},`,
        `${input.shopName} has invited you to their ${PRODUCT_NAME} workspace as ${input.roleName}. Create your account with this email address to get started. The invite expires in 7 days.`,
      ],
      button: { label: "Accept invite", url: input.inviteUrl },
    },
    {
      heading: `دعوة للانضمام إلى ${input.shopName}`,
      body: [
        `مرحبًا ${input.inviteeName}،`,
        `دعاك ${input.shopName} للانضمام إلى مساحة العمل بدور ${input.roleName}. أنشئ حسابك بنفس هذا البريد الإلكتروني للبدء. تنتهي صلاحية الدعوة خلال 7 أيام.`,
      ],
      button: { label: "قبول الدعوة", url: input.inviteUrl },
    }
  );
  return { to, subject: `You're invited to join ${input.shopName} on ${PRODUCT_NAME}`, html, text };
}

export function shopSetupEmail(
  to: string,
  input: { name: string; shopName: string; setupUrl: string; trialEndsAt: Date | null }
): EmailMessage {
  const trialDate = input.trialEndsAt?.toISOString().slice(0, 10);
  const { html, text } = layout(
    {
      heading: `Welcome to ${PRODUCT_NAME}, ${input.name}`,
      body: [
        `Your workspace for ${input.shopName} is ready. Choose a password to sign in. This link works once and expires in 7 days.`,
        ...(trialDate ? [`Your free trial runs until ${trialDate}. No card is needed until then.`] : []),
      ],
      button: { label: "Set your password", url: input.setupUrl },
      footnote: "If the link has expired, use \"Forgot password?\" on the sign-in page with this email address.",
    },
    {
      heading: `مرحبًا بك في ${PRODUCT_NAME_AR}`,
      body: [
        `مساحة العمل الخاصة بـ ${input.shopName} جاهزة. اختر كلمة مرور لتسجيل الدخول. هذا الرابط يعمل مرة واحدة وتنتهي صلاحيته خلال 7 أيام.`,
        ...(trialDate ? [`تستمر الفترة التجريبية المجانية حتى ${trialDate}. لا حاجة لبطاقة دفع حتى ذلك الحين.`] : []),
      ],
      button: { label: "تعيين كلمة المرور", url: input.setupUrl },
      footnote: "إذا انتهت صلاحية الرابط، استخدم «نسيت كلمة المرور؟» في صفحة تسجيل الدخول بهذا البريد الإلكتروني.",
    }
  );
  return { to, subject: `Your ${PRODUCT_NAME} workspace for ${input.shopName} is ready`, html, text };
}

export function operatorInviteEmail(to: string, details: { name: string; setupUrl: string }): EmailMessage {
  const { html, text } = layout(
    {
      heading: `You've been added to the ${PRODUCT_NAME} operations team`,
      body: [
        `Hi ${details.name}, you now have operator access to ${PRODUCT_NAME}. Choose a password to finish setting up your account. This link works once and expires in 24 hours.`,
      ],
      button: { label: "Set your password", url: details.setupUrl },
      footnote: "If you weren't expecting this, you can ignore this email.",
    },
    {
      heading: `تمت إضافتك إلى فريق عمليات ${PRODUCT_NAME_AR}`,
      body: [`مرحبًا ${details.name}، أصبح لديك وصول تشغيلي إلى ${PRODUCT_NAME_AR}. اختر كلمة مرور لإكمال إعداد حسابك. يعمل هذا الرابط مرة واحدة وتنتهي صلاحيته خلال 24 ساعة.`],
      button: { label: "تعيين كلمة المرور", url: details.setupUrl },
      footnote: "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها.",
    }
  );
  return { to, subject: `Your ${PRODUCT_NAME} operator account`, html, text };
}

export type DemoRequestDetails = {
  name: string;
  shopName: string;
  email: string;
  phone: string | null;
  message: string | null;
  language: "en" | "ar";
};

/** Internal notification to the sales inbox; replies go to the prospect. */
export function demoRequestEmail(to: string, request: DemoRequestDetails): EmailMessage {
  const rows: Array<[string, string]> = [
    ["Name", request.name],
    ["Shop", request.shopName],
    ["Email", request.email],
    ["Phone", request.phone ?? "—"],
    ["Site language", request.language === "ar" ? "Arabic" : "English"],
  ];
  const message = request.message ?? "(no message)";
  const html = `<!doctype html><html><body style="margin:0;background:#F7F4EE;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border:1px solid #E8E1D3;border-radius:16px;padding:28px;">
      <h1 style="font-size:20px;margin:0 0 16px;color:#111733;">New demo request</h1>
      <table style="border-collapse:collapse;font-size:14px;color:#111733;">
        ${rows.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#5B6380;">${escapeHtml(label)}</td><td style="padding:4px 0;" dir="auto">${escapeHtml(value)}</td></tr>`).join("")}
      </table>
      <p style="margin:16px 0 0;line-height:1.5;color:#111733;white-space:pre-wrap;" dir="auto">${escapeHtml(message)}</p>
      <p style="margin:20px 0 0;font-size:12px;color:#5B6380;">Reply to this email to answer ${escapeHtml(request.name)} directly.</p>
    </div>
  </div></body></html>`;
  const text = `New demo request\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${message}\n`;
  return { to, subject: `Demo request: ${request.shopName} (${request.name})`, html, text, replyTo: request.email };
}
