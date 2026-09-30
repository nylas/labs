---
"ownmail": patch
---

Shrink the published CLI by about 0.5 MB so `npx ownmail` starts faster: the prebuilt browser client ships once and is restored for Vercel, Netlify, and local targets, unused type declarations and source maps are no longer published, and bundled images are losslessly recompressed.
