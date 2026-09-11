import { render } from "preact";
import { App } from "./App.jsx";

const root = document.getElementById("root");
// The shell paints a static hero so the first frame is not blank; replace it.
root.replaceChildren();
render(<App />, root);
