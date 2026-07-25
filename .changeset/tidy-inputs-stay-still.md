---
"@ownmail/app": patch
---

Prevent unintended iOS Safari zoom when focusing inputs: the touch-device 16px minimum now covers every contenteditable variant (not just `contenteditable="true"`) and inline code spans inside the compose markdown editor. Desktop type scale is unchanged.
