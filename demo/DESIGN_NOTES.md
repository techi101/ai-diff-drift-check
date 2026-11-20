# Design notes

North star: the warp.dev homepage (screenshotted 21 Nov 2026 next to Seezo, Semgrep, Snyk, Chainguard, Wiz, Vercel, Linear, Resend, Railway, Graphite, Tailscale and Oxide; land-book, lapa.ninja, saaspo, siteinspire and socket.dev blocked the headless browser).

What this page takes from it:

- **The hero is a figure, not a pitch.** Warp puts a framed "fig. 1" plate under a left-aligned headline. Here the plate holds the real drifted diff (case sr07-hard-headers) with the two verdicts that disagree, and the caption carries the requirement it breaks.
- **Unit squares as the data visual.** Warp's grid of small squares, mostly quiet with a few coloured ones, became the scoreboard: one square per labeled case, solid for violations and outlined for honored cases. Ink means the system got it right, red means wrong, amber means left unresolved. The requirements matrix uses the same marks.
- **A cool, nearly white page with faint structure.** A dot grid and two column guides sit behind the hero and fade out as you scroll. Below the hero there are hairlines only, with no cards and no shadows.
- **One dark primary button and one outlined button.** Colour is kept for meaning. Periwinkle is only for links and focus, and red, green and amber are only for verdicts.
- **A big left-aligned headline with generous space and a narrow measure.** Body text stays under about 70 characters per line.

Where I did not follow Warp, and why:

- Warp sets its headline and labels in monospace, and its nav in all caps. The brief rules out mono labels and all-caps text, so the page uses Fraunces for display, Satoshi for UI text and IBM Plex Mono only inside code.
- Warp is darker and denser further down the page. This page stays light because it is mostly reading.

Motion is one sequence. The drift line highlights, its note appears, the rules verdict lands, the judge verdict lands, and then a red line strikes through the rules' "honored". The scoreboard squares grow the first time they scroll into view and again when the Plain, Tricky and All switch changes. All of it is turned off under prefers-reduced-motion.
