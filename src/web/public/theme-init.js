// Apply the remembered appearance before the first paint (site.ts keeps it up to date).
(function () {
  var d = document.documentElement;
  try {
    var old = {
      lagoon: "minimal-coral",
      ocean: "minimal-ocean",
      grape: "minimal-grape",
      sunset: "minimal-coral",
      sakura: "aurora-sunset",
      forest: "minimal-forest",
      graphite: "minimal-ocean",
    };
    var t = localStorage.getItem("my-theme") || localStorage.getItem("site-theme") || "minimal-coral";
    t = old[t] || t;
    var p = t.split("-");
    if (p.length === 2) {
      d.setAttribute("data-style", p[0]);
      d.setAttribute("data-accent", p[1]);
    }
  } catch (e) {}
  var m = null;
  try {
    m = localStorage.getItem("my-mode");
  } catch (e) {}
  if (m !== "light" && m !== "dark")
    m = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  d.setAttribute("data-mode", m);
})();
