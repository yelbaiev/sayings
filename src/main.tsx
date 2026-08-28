import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "~/App";
// One entry stylesheet: the theme, the utilities, and the component CSS that stays CSS on
// purpose (keypad grid, sticky matrix, collapse) all arrive through it. See ADR 0006.
import "~/styles/tailwind.css";
import { installPressFlash } from "~/lib/press-flash";

/* Touch feedback for every control in the app, from one listener. See ~/lib/press-flash. */
installPressFlash();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
