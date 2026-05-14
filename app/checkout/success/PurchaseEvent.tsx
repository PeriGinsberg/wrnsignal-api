"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    gtag?: (...args: any[]) => void;
  }
}

// Read a sessionStorage key with a try/catch so private-browsing and SSR
// environments never throw. Returns undefined on miss so the field is
// omitted from the event payload rather than sent as an empty string.
function ss(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function getEventUtmParams() {
  return {
    utm_source: ss("signal_utm_source"),
    utm_medium: ss("signal_utm_medium"),
    utm_campaign: ss("signal_utm_campaign"),
    utm_content: ss("signal_utm_content"),
    utm_term: ss("signal_utm_term"),
  };
}

export default function PurchaseEvent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";

  useEffect(() => {
    const utm = getEventUtmParams();

    // Meta Purchase — eventID = Stripe session_id so the Stripe webhook's
    // server-side CAPI Purchase deduplicates against this client-side fire.
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "Purchase", {
        value: 99,
        currency: "USD",
        content_name: "SIGNAL 90-day access",
        ...utm,
      }, {
        eventID: sessionId,
      });
    }

    // Google Ads conversion — keeps the existing Ads-side reporting.
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "conversion", {
        send_to: "AW-11125129027/T1WACMTsraUcEMP-77gp",
        value: 99.0,
        currency: "USD",
        transaction_id: sessionId,
      });
    }

    // GA4 standard ecommerce purchase event — separate from the Ads
    // conversion above. Lets GA4 reports show purchase as a real event.
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "purchase", {
        transaction_id: sessionId,
        value: 99.0,
        currency: "USD",
        items: [
          {
            item_id: "signal-access",
            item_name: "SIGNAL 90-day access",
            price: 99.0,
            quantity: 1,
          },
        ],
        ...utm,
      });
    }
  }, [sessionId]);

  return null;
}
