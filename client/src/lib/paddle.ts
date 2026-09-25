// Minimal typing for the parts of Paddle.js v2 we use. Loaded on demand from
// Paddle's CDN (it cannot be bundled) only when someone opens checkout.
type PaddleEventData = { name?: string };

type PaddleCheckoutOptions = {
  items: Array<{ priceId: string; quantity: number }>;
  customer?: { email: string };
  customData?: Record<string, string>;
  settings?: { displayMode?: "overlay"; locale?: string; successUrl?: string };
};

type PaddleGlobal = {
  Environment: { set(environment: "sandbox" | "production"): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEventData) => void }): void;
  Checkout: { open(options: PaddleCheckoutOptions): void };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_SCRIPT_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";
let loading: Promise<PaddleGlobal> | null = null;
let initializedToken: string | null = null;
let eventListener: ((event: PaddleEventData) => void) | null = null;

function loadScript(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PADDLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error("Paddle failed to load.")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load the payment form. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openPaddleCheckout(config: {
  environment: "sandbox" | "production";
  clientToken: string;
  priceId: string;
  customerEmail?: string;
  customData: Record<string, string>;
  locale: string;
  onEvent: (event: PaddleEventData) => void;
}) {
  const paddle = await loadScript();
  eventListener = config.onEvent;
  if (initializedToken !== config.clientToken) {
    paddle.Environment.set(config.environment);
    paddle.Initialize({ token: config.clientToken, eventCallback: event => eventListener?.(event) });
    initializedToken = config.clientToken;
  }
  paddle.Checkout.open({
    items: [{ priceId: config.priceId, quantity: 1 }],
    customer: config.customerEmail ? { email: config.customerEmail } : undefined,
    customData: config.customData,
    settings: { displayMode: "overlay", locale: config.locale },
  });
}
