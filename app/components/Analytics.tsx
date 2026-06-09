"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

const CONVERSION_PATH = "/checkout/success";

export default function Analytics() {
  const pathname = usePathname();
  // The backend is an app/API host, not a marketing surface. Load Meta Pixel +
  // Google tags ONLY on the post-purchase conversion page, where PurchaseEvent
  // fires Purchase / Google Ads / GA4. Every other backend page (dashboard,
  // positioning, feedback) renders nothing — so no PageView pixel fires off
  // wrnsignal-api(-staging).vercel.app or localhost. usePathname is SSR-safe
  // (same value server + client), so no hydration mismatch and no load-timing
  // delay — PurchaseEvent's fbq/gtag calls are unaffected.
  if (pathname !== CONVERSION_PATH) return null;

  return (
    <>
      {/* Meta Pixel */}
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '2301309867062153');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src="https://www.facebook.com/tr?id=2301309867062153&ev=PageView&noscript=1"
          alt=""
        />
      </noscript>

      {/* Google tag (gtag.js) */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=AW-11125129027"
        strategy="afterInteractive"
      />
      <Script id="google-tag" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'AW-11125129027');
        `}
      </Script>
    </>
  );
}
