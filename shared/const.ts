export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
export const ORG_SUSPENDED_ERR_MSG = "This organization's access has been suspended. Contact support. (10003)";
export const NOT_PLATFORM_STAFF_ERR_MSG = 'You do not have platform operator access (10004)';
export const BILLING_READ_ONLY_ERR_MSG = "Your shop is in read-only mode until a subscription is active. Visit Billing to continue. (10005)";
/** Product name used in server-generated copy such as emails. */
export const PRODUCT_NAME = "Tafsell";
// Tafsell is built and run by NewMux; shown as "Tafsell, powered by NewMux".
export const COMPANY_NAME = "NewMux";
export const COMPANY_URL = "https://www.newmux.com/";
// Public marketing site (separate repo: tafsell-landing).
export const MARKETING_SITE_URL = "https://tafsell-landing.vercel.app/";

// Staff documents are sent base64-encoded in one API request, and Vercel
// rejects request bodies over 4.5 MB: 3 MB of file is ~4 MB once encoded.
export const MAX_STAFF_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_STAFF_DOCUMENT_BASE64_LENGTH = Math.ceil(MAX_STAFF_DOCUMENT_BYTES / 3) * 4;
