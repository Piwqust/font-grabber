import { useEffect, useRef } from "preact/hooks";
import { StoreProvider, useStore } from "./store.jsx";
import { Header } from "./sections/Header.jsx";
import { Hero } from "./sections/Hero.jsx";
import { HowItWorks } from "./sections/HowItWorks.jsx";
import { Capabilities } from "./sections/Capabilities.jsx";
import { Playground } from "./sections/Playground.jsx";
import { Extension } from "./sections/Extension.jsx";
import { Footer } from "./sections/Footer.jsx";
import { Catalog } from "./catalog/Catalog.jsx";
import { MetadataEditor } from "./metadata/MetadataEditor.jsx";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const store = useStore();

  const editing = store.metadata.open;
  const wasEditing = useRef(false);

  // A finished scan takes over the page. Focus moves with it, or a keyboard
  // user is left at the top of a page whose content has been replaced. Coming
  // back out of the editor is the exception: the store puts focus back on the
  // control the editor was opened from, and this must not fight it.
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      return;
    }
    if (!store.hasResults) return;
    if (wasEditing.current) {
      wasEditing.current = false;
      return;
    }
    const results = document.getElementById("results");
    results?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, [store.hasResults, store.source, editing]);

  return (
    <>
      <a class="skip" href={editing ? "#meta-family" : "#url"}>
        {editing ? "Skip to the family name" : "Skip to the website address"}
      </a>
      <Header />
      {editing ? (
        <MetadataEditor />
      ) : store.hasResults ? (
        <Catalog />
      ) : (
        <main class="landing">
          <Hero />
          <HowItWorks />
          <Capabilities />
          <Playground />
          <Extension />
        </main>
      )}
      <Footer />
    </>
  );
}
