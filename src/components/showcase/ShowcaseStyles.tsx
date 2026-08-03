// Scoped CTC Prophit Engine brand tokens + primitives for the public showcase.
//
// Everything is namespaced under `.pe-showcase` so the client-facing page can use
// the Prophit Engine palette (dark navy / lime / teal) WITHOUT touching the CRM's
// own charcoal+orange theme in globals.css. This keeps the house mechanism
// (CSS variables + inline styles, no new UI library) while honoring the brief's
// design direction. Colors are exact per the ctc-prophit-brand guidelines.

export const PE = 'pe-showcase'

export default function ShowcaseStyles() {
  return (
    <style
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: `
.${PE} {
  /* Palette */
  --pe-navy:#0C1E2D; --pe-deep-navy:#173749;
  --pe-lime:#D3F05F; --pe-lime-bright:#CBFF00;
  --pe-teal:#00E4E6; --pe-dark-teal:#00A3A5; --pe-muted-teal:#286C6D;
  --pe-off:#F4F0F6; --pe-white:#FFFFFF; --pe-muted:#9AAFB9;
  --pe-card:#0F2536; --pe-card-2:#122C40; --pe-border:rgba(255,255,255,0.10);
  /* Never serif — Neue Haas Grotesk fallbacks per brand */
  --pe-font:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;
  --pe-radius-card:30px; --pe-radius-sm:16px; --pe-radius-pill:1500px;

  background:var(--pe-navy);
  color:var(--pe-white);
  font-family:var(--pe-font);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  min-height:100vh;
  letter-spacing:-0.0125em;
}
.${PE} *,.${PE} *::before,.${PE} *::after { box-sizing:border-box; }
.${PE} ::selection { background:var(--pe-lime); color:var(--pe-navy); }

.${PE} .pe-container { max-width:1120px; margin:0 auto; padding:0 24px; }
.${PE} .pe-eyebrow {
  font-size:13px; font-weight:600; letter-spacing:0.16em; text-transform:uppercase;
  color:var(--pe-lime); margin:0;
}
.${PE} .pe-label {
  font-size:11px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase;
  color:var(--pe-muted); margin:0;
}

/* Oversized numerals — the stats are the design. */
.${PE} .pe-stat-mega {
  font-weight:600; line-height:0.95; letter-spacing:-0.04em;
  font-size:clamp(72px, 13vw, 168px);
  background:linear-gradient(180deg,#EAFBA6 0%, var(--pe-lime) 60%, #B9DD3E 100%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
}
.${PE} .pe-stat-big { font-weight:600; line-height:1; letter-spacing:-0.03em; font-size:clamp(40px,6vw,64px); }

.${PE} .pe-card {
  background:var(--pe-card); border:1px solid var(--pe-border);
  border-radius:var(--pe-radius-card); overflow:hidden;
}
.${PE} .pe-card-sm { border-radius:var(--pe-radius-sm); }

/* Pill button — teal on dark, hover → lime */
.${PE} .pe-btn {
  display:inline-flex; align-items:center; gap:10px;
  background:var(--pe-teal); color:var(--pe-navy);
  font-family:var(--pe-font); font-size:18px; font-weight:500;
  padding:14px 36px; border:none; border-radius:var(--pe-radius-pill);
  cursor:pointer; text-decoration:none;
  transition:background-color .3s ease, transform .12s ease;
}
.${PE} .pe-btn:hover { background:var(--pe-lime); }
.${PE} .pe-btn:active { transform:translateY(1px); }
.${PE} .pe-btn:disabled { opacity:.5; cursor:not-allowed; }

.${PE} .pe-chip {
  display:inline-flex; align-items:center; gap:6px;
  font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase;
  color:var(--pe-navy); background:var(--pe-lime);
  padding:4px 10px; border-radius:100px;
}

.${PE} :focus-visible { outline:2px solid var(--pe-teal); outline-offset:3px; border-radius:6px; }

/* Redaction (see RedactedImage.tsx). The box is the container the regions are
   measured against; the px radius is the fallback for engines without cqw, so
   an unsupported unit degrades to a weaker blur rather than to none at all.
   These are only the defaults — a scanned region carries its own radius, sized
   to the mark, and sets it inline. */
.${PE} .pe-blur-box { position:relative; container-type:inline-size; }
.${PE} .pe-blur {
  position:absolute; pointer-events:none; user-select:none;
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  backdrop-filter:blur(1.4cqw); -webkit-backdrop-filter:blur(1.4cqw);
}

/* Entrance animation (respects reduced-motion below) */
@keyframes peFadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.${PE} .pe-fade { animation:peFadeUp .5s ease both; }

@media (prefers-reduced-motion: reduce) {
  .${PE} .pe-fade { animation:none; }
  .${PE} * { scroll-behavior:auto !important; }
}
`,
      }}
    />
  )
}
