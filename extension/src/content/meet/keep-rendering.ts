// Runs in Meet's own world at document_start, before the page keeps a reference to
// requestAnimationFrame (docs/adr/0005). The only content script in the page's world: the
// adapter stays in the isolated world.

import { keepRendering } from "./rendering";

keepRendering(window, document);
