(function () {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const panelSelector = [
    ".top-nav",
    ".floating-nav",
    ".panel-card",
    ".access-card",
    ".admin-panel",
    ".request-card",
    ".product-card",
    ".inventory-card",
    ".order-card",
    ".compact-product-card",
    ".review-card",
    ".payout-card",
    ".detail-gallery",
    ".detail-info",
    ".catalog-stage",
    ".hero-showcase",
    ".hero-showcase-product",
    ".member-focus-card",
    ".seller-hero",
    ".seller-center-hero",
    ".buyer-center-hero",
    ".entry-flip-card",
    ".entry-start-button",
    ".entry-connect-launch",
    ".entry-enter-button"
  ].join(", ");

  const buttonSelector = [
    ".button",
    ".cart-toggle",
    ".floating-mini-toggle",
    ".category-chip",
    ".segment-tab",
    ".entry-start-button",
    ".entry-connect-launch",
    ".entry-enter-button",
    ".floating-nav-links a"
  ].join(", ");

  function setPanelPointer(panel, event) {
    const rect = panel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    panel.style.setProperty("--web3-x", `${x}%`);
    panel.style.setProperty("--web3-y", `${y}%`);
  }

  function attachPanelMotion(panel, index) {
    panel.classList.add("web3-panel");
    panel.style.setProperty("--web3-delay", `${Math.min(index * 55, 420)}ms`);
    panel.style.setProperty("--web3-x", "50%");
    panel.style.setProperty("--web3-y", "50%");

    if (prefersReducedMotion) {
      panel.classList.add("is-visible");
      return;
    }

    panel.addEventListener("mousemove", (event) => setPanelPointer(panel, event));
    panel.addEventListener("mouseleave", () => {
      panel.style.setProperty("--web3-x", "50%");
      panel.style.setProperty("--web3-y", "50%");
    });
  }

  function attachButtonRipple(button) {
    button.classList.add("web3-button");
    if (prefersReducedMotion) return;
    button.addEventListener("click", (event) => {
      const ripple = document.createElement("span");
      ripple.className = "web3-ripple";
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.append(ripple);
      window.setTimeout(() => ripple.remove(), 620);
    });
  }

  function runObserver(targets) {
    if (prefersReducedMotion) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.16,
      rootMargin: "0px 0px -6% 0px"
    });

    targets.forEach((target) => observer.observe(target));
  }

  function decorateEntryWordmark() {
    const letters = document.querySelectorAll(".entry-wordmark span");
    letters.forEach((letter, index) => {
      letter.style.setProperty("--glyph-delay", `${index * 140}ms`);
      letter.classList.add("web3-glyph");
    });
  }

  function decorateGridPulse() {
    document.body.classList.add("web3-ready");
  }

  function decorateTokenSwarm() {
    const isStoreSurface = document.body.classList.contains("console-body");
    const isEntrySurface = document.body.classList.contains("entry-body");
    if (!isStoreSurface && !isEntrySurface) return;
    if (document.querySelector(".token-swarm")) return;

    const swarm = document.createElement("div");
    swarm.className = "token-swarm";

    const glyphs = isEntrySurface
      ? [
          { type: "btc", left: "7%", top: "14%", size: "92px", delay: "0s", speed: "20s", rotate: "-7deg" },
          { type: "eth", left: "82%", top: "16%", size: "88px", delay: "1.1s", speed: "23s", rotate: "8deg" },
          { type: "usdt", left: "12%", top: "64%", size: "104px", delay: "1.8s", speed: "26s", rotate: "-6deg" },
          { type: "btc", left: "78%", top: "74%", size: "84px", delay: "2.4s", speed: "22s", rotate: "10deg" },
          { type: "eth", left: "56%", top: "8%", size: "74px", delay: "3.2s", speed: "24s", rotate: "-4deg" },
          { type: "usdt", left: "88%", top: "46%", size: "82px", delay: "1.6s", speed: "25s", rotate: "5deg" }
        ]
      : [
          { type: "btc", left: "4.5%", top: "12%", size: "112px", delay: "0s", speed: "18s", rotate: "-8deg" },
          { type: "eth", left: "82%", top: "14%", size: "98px", delay: "1.4s", speed: "22s", rotate: "9deg" },
          { type: "usdt", left: "10%", top: "56%", size: "118px", delay: "0.8s", speed: "26s", rotate: "-4deg" },
          { type: "btc", left: "88%", top: "64%", size: "90px", delay: "2.4s", speed: "21s", rotate: "7deg" },
          { type: "usdt", left: "70%", top: "78%", size: "108px", delay: "1.1s", speed: "24s", rotate: "-10deg" },
          { type: "eth", left: "72%", top: "8%", size: "92px", delay: "2.8s", speed: "28s", rotate: "6deg" },
          { type: "btc", left: "28%", top: "82%", size: "86px", delay: "3.4s", speed: "20s", rotate: "-9deg" },
          { type: "eth", left: "18%", top: "32%", size: "72px", delay: "2.2s", speed: "19s", rotate: "4deg" },
          { type: "usdt", left: "90%", top: "36%", size: "88px", delay: "3s", speed: "21s", rotate: "-7deg" }
        ];

    glyphs.forEach((glyph) => {
      const img = document.createElement("img");
      img.className = `token-glyph token-glyph-${glyph.type}`;
      img.alt = `${glyph.type} decorative glyph`;
      img.src = `/frontend/assets/token-${glyph.type}-pixel.svg`;
      img.style.setProperty("--token-left", glyph.left);
      img.style.setProperty("--token-top", glyph.top);
      img.style.setProperty("--token-size", glyph.size);
      img.style.setProperty("--token-delay", glyph.delay);
      img.style.setProperty("--token-speed", glyph.speed);
      img.style.setProperty("--token-rotate", glyph.rotate);
      swarm.append(img);
    });

    document.body.append(swarm);
  }

  document.addEventListener("DOMContentLoaded", () => {
    decorateGridPulse();
    decorateEntryWordmark();
    decorateTokenSwarm();

    const panels = Array.from(document.querySelectorAll(panelSelector));
    panels.forEach((panel, index) => attachPanelMotion(panel, index));
    runObserver(panels);

    const buttons = Array.from(document.querySelectorAll(buttonSelector));
    buttons.forEach((button) => attachButtonRipple(button));
  });
})();
