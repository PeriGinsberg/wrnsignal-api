"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    gtag?: (...args: any[]) => void;
  }
}

export default function PurchaseEvent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";

  useEffect(() => {
    // Fire Meta Purchase
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "Purchase", {
        value: 99,
        currency: "USD",
        content_name: "SIGNAL 90-day access"
      }, {
        eventID: sessionId  // dedup key
      });
    }

    // Fire Google Purchase
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "conversion", {
        send_to: "AW-11125129027/T1WACMTsraUcEMP-77gp",
        value: 99.0,
        currency: "USD",
        transaction_id: sessionId  // dedup key
      });
    }
  }, [sessionId]);

  return null;
}
