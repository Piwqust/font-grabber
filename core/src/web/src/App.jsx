import { useEffect } from "preact/hooks";
import { StoreProvider, useStore } from "./store.jsx";
import { Header } from "./sections/Header.jsx";
import { Hero } from "./sections/Hero.jsx";
import { HowItWorks } from "./sections/HowItWorks.jsx";
import { Capabilities } from "./sections/Capabilities.jsx";
import { Playground } from "./sections/Playground.jsx";
import { Extension } from "./sections/Extension.jsx";
import { Footer } from "./sections/Footer.jsx";
import { Catalog } from "./catalog/Catalog.jsx";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const store = useStore();

  // A finished scan takes over the page. Focus moves with it, or a keyboard
  // user is left at the top of a page whose content has been replaced.
  useEffect(() => {
    if (!store.hasResults) return;
    const results = document.getElementById("results");
    results?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, [store.hasResults, store.source]);

  return (
    <>
      <a class="skip" href="#url">
        Skip to the website address
      </a>
      <Header />
      {store.hasResults ? (
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
