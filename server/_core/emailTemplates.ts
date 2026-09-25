import { PRODUCT_NAME } from "@shared/const";
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
      <h1 style="font-size:20px;margin:0 0 12px;color:#1c1917;">${escapeHtml(section.heading)}</h1>
      ${section.body.map(p => `<p style="margin:0 0 12px;line-height:1.5;color:#44403c;">${escapeHtml(p)}</p>`).join("")}
      ${
        section.button
          ? `<p style="margin:20px 0;"><a href="${escapeHtml(section.button.url)}" style="background:#1c1917;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;">${escapeHtml(section.button.label)}</a></p>`
          : ""
      }
      ${section.footnote ? `<p style="margin:0;font-size:12px;color:#78716c;">${escapeHtml(section.footnote)}</p>` : ""}
    </div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;padding:28px;">
      ${block(english, "ltr")}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0;" />
      ${block(arabic, "rtl")}
    </div>
    <p style="text-align:center;font-size:12px;color:#a8a29e;margin-top:16px;">${escapeHtml(PRODUCT_NAME)}</p>
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

export function welcomeEmail(to: string, input: { name: string; shopName: string; appUrl: string; trialEndsAt: Date | null }): EmailMessage {
  const trialDate = input.trialEndsAt?.toISOString().slice(0, 10);
  const { html, text } = layout(
    {
      heading: `Welcome to ${PRODUCT_NAME}, ${input.name}`,
      body: [
        `Your workspace for ${input.shopName} is ready.`,
        ...(trialDate ? [`Your free trial runs until ${trialDate}. No card is needed until then.`] : []),
      ],
      button: { label: "Open your workspace", url: input.appUrl },
    },
    {
      heading: `مرحبًا بك في ${PRODUCT_NAME}`,
      body: [
        `مساحة العمل الخاصة بـ ${input.shopName} جاهزة.`,
        ...(trialDate ? [`تستمر الفترة التجريبية المجانية حتى ${trialDate}. لا حاجة لبطاقة دفع حتى ذلك الحين.`] : []),
      ],
      button: { label: "فتح مساحة العمل", url: input.appUrl },
    }
  );
  return { to, subject: `Welcome to ${PRODUCT_NAME}`, html, text };
}
