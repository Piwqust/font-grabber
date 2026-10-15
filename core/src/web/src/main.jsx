import { render } from "preact";
import { App } from "./App.jsx";

// A font dropped beside the drop zone would otherwise navigate the tab to the
// file. The drop zone prevents the default itself, so it is left alone here.
const carriesFiles = (event) => event.dataTransfer?.types?.includes("Files");
window.addEventListener("dragover", (event) => {
  if (event.defaultPrevented || !carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "none";
});
window.addEventListener("drop", (event) => {
  if (carriesFiles(event)) event.preventDefault();
});

const root = document.getElementById("root");
// The shell paints a static hero so the first frame is not blank; replace it.
root.replaceChildren();
render(<App />, root);
