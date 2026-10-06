/**
 * Scripts embedded in generated pages. They run in the page, not the app,
 * so they're plain strings of browser JavaScript.
 */

/** Waits until fonts and images are ready, then tells the app to print. */
export const PRINT_READY_SCRIPT = `(function () {
  var images = Array.prototype.map.call(document.images, function (image) {
    return image.decode ? image.decode().catch(function () {}) : null;
  });
  Promise.all([document.fonts ? document.fonts.ready : null].concat(images)).then(function () {
    setTimeout(function () { fetch("ready").catch(function () {}); }, 50);
  });
})();`;

/**
 * The export window's preview. It loads once; the window then sends each
 * change of options as a message with the new stylesheet and layout, and the
 * page restyles and re-flows itself in place, keeping its scroll position.
 *
 * For PDF and Word ("pages"), the shard flows through fixed-size columns, one
 * per page, so the browser's own fragmentation decides the breaks with the
 * same rules it prints with: headings stay with what follows, code blocks
 * and images don't split. Each page shows its column of a copy of the flow;
 * pages in view get theirs at once, the rest when they scroll near. For a
 * web page ("web"), the shard is shown as the page itself.
 *
 * The URL fragment carries the app's backdrop and scrollbar colors, so the
 * preview looks like part of the window.
 */
export const PREVIEW_SCRIPT = `(function () {
  var root = document.documentElement;
  var flow = document.getElementById("flow");
  var pages = document.getElementById("pages");
  var look = document.getElementById("look");
  var MESSAGE = "netherstone-export-preview";
  var state = { layout: root.getAttribute("data-layout"), pageNumbers: root.getAttribute("data-page-numbers") === "true" };
  var observer = null;

  var params = {};
  location.hash.slice(1).split("&").forEach(function (pair) {
    var parts = pair.split("=");
    if (parts[0]) params[parts[0]] = decodeURIComponent(parts[1] || "");
  });
  if (params.thumb) {
    root.style.scrollbarWidth = "thin";
    root.style.scrollbarColor = params.thumb + " transparent";
  }

  function cssPixels(name) {
    return parseFloat(getComputedStyle(root).getPropertyValue(name));
  }

  function scrollRatio() {
    var range = root.scrollHeight - window.innerHeight;
    return range > 0 ? window.scrollY / range : 0;
  }

  function fit() {
    if (state.layout !== "pages") return;
    var zoom = Math.min(1, (window.innerWidth - 48) / cssPixels("--page-width"));
    root.style.setProperty("--zoom", String(Math.max(zoom, 0.2)));
  }

  function paginate() {
    if (observer) observer.disconnect();
    pages.textContent = "";
    if (state.layout !== "pages") return null;

    var gap = cssPixels("--column-gap");
    var pitch = cssPixels("--content-width") + gap;
    var count = Math.max(1, Math.round((flow.scrollWidth + gap) / pitch));
    // Chromium prints the footer in the page margin; WebKit can't, so the
    // preview only shows one where the PDF will have it.
    var footers = state.pageNumbers && /Chrome\\//.test(navigator.userAgent);
    var title = root.getAttribute("data-title") || "";

    function fill(page) {
      var body = page.firstChild;
      if (body.childElementCount) return;
      var copy = flow.cloneNode(true);
      copy.removeAttribute("id");
      copy.style.left = -Number(page.getAttribute("data-index")) * pitch + "px";
      body.appendChild(copy);
    }

    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        fill(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "1600px 0px" });

    var all = [];
    for (var index = 0; index < count; index += 1) {
      var page = document.createElement("div");
      page.className = "page";
      page.setAttribute("data-index", String(index));
      var body = document.createElement("div");
      body.className = "page-body";
      page.appendChild(body);
      if (footers) {
        var footer = document.createElement("div");
        footer.className = "page-footer";
        var name = document.createElement("span");
        name.textContent = title;
        var number = document.createElement("span");
        number.textContent = index + 1 + " / " + count;
        footer.appendChild(name);
        footer.appendChild(number);
        page.appendChild(footer);
      }
      pages.appendChild(page);
      all.push(page);
    }
    return { count: count, pages: all, fill: fill };
  }

  // Lays out, returns to the same place in the shard, and fills what's in
  // view, all before the browser paints, so a change never flashes.
  function render(ratio) {
    root.setAttribute("data-layout", state.layout);
    root.style.background = state.layout === "pages" && params.bg ? params.bg : "";
    fit();
    var result = paginate();
    var range = root.scrollHeight - window.innerHeight;
    window.scrollTo(0, ratio * Math.max(range, 0));
    if (result) {
      result.pages.forEach(function (page) {
        var box = page.getBoundingClientRect();
        if (box.bottom > -window.innerHeight && box.top < window.innerHeight * 2) result.fill(page);
        else observer.observe(page);
      });
    }
    parent.postMessage({ type: MESSAGE, pages: result ? result.count : null }, "*");
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "netherstone-export-preview-look") return;
    var ratio = scrollRatio();
    look.textContent = data.css;
    state.layout = data.layout;
    state.pageNumbers = data.pageNumbers;
    render(ratio);
  });

  var resizeFrame = 0;
  window.addEventListener("resize", function () {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fit);
  });

  var scrollTimer = 0;
  window.addEventListener("scroll", function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      parent.postMessage({ type: MESSAGE, scroll: scrollRatio() }, "*");
    }, 80);
  });

  var images = Array.prototype.map.call(document.images, function (image) {
    return image.decode ? image.decode().catch(function () {}) : null;
  });
  Promise.all([document.fonts.ready].concat(images)).then(function () {
    render(0);
    // Shown only once painted, so the window never reveals a blank frame.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { parent.postMessage({ type: MESSAGE, ready: true }, "*"); });
    });
  });
})();`;
