import { ENV, isEmailConfigured } from "./env";
import { logger } from "./logger";
import { captureError } from "./sentry";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Sends one transactional email through Resend's HTTP API.
 *
 * Never throws: an email failure must not fail the request that triggered
 * it (a signup still succeeds if the welcome email bounces). Callers use the
 * returned `sent` flag to decide whether to fall back to showing a link.
 */
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) {
    logger.debug({ to: message.to, subject: message.subject }, "Email not configured; skipping send");
    return { sent: false };
  }
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.emailFrom,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend responded ${response.status}: ${body.slice(0, 500)}`);
    }
    logger.info({ to: message.to, subject: message.subject }, "Email sent");
    return { sent: true };
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, "Email send failed");
    captureError(err);
    return { sent: false };
  }
}
