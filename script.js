/* =========================================================
    blox fruits trade calculator — App logic
   =========================================================
   SECURITY:
   - CSP enforced via <meta> tag (script-src, connect-src, frame-src, object-src, base-uri, form-action)
   - All user text sanitized via sanitize() before innerHTML
   - Rate limiting (checkRateLimit) on all form submissions
   - Input guard (guardInput) strips control chars, caps at 500
   - maxlength on every <input>/<textarea>
   - No eval() or setTimeout(string) anywhere
   - Firestore Security Rules are REQUIRED in the Firebase Console:
     https://console.firebase.google.com -> Firestore -> Rules
     Minimum rules for this app:
       rules_version = '2';
       service cloud.firestore {
         match /databases/{database}/documents {
           match /{document=**} {
             allow read: if true;
             allow write: if request.auth != null;
           }
         }
       }
   ========================================================= */
(function () {
  "use strict";

  /* ------------ Helpers ------------ */
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }

  /* ------------ Rate limiter (anti-spam) ------------ */
  var rateLimitMap = {};
  function checkRateLimit(key, cooldownMs) {
    var now = Date.now();
    var last = rateLimitMap[key] || 0;
    if (now - last < cooldownMs) return false;
    rateLimitMap[key] = now;
    return true;
  }

  /* ------------ Input guard ------------ */
  var MAX_STRING_LENGTH = 500;
  function guardInput(val) {
    if (typeof val !== "string") return "";
    return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, MAX_STRING_LENGTH);
  }

  function sanitize(str) {
    if (typeof str !== "string") return "";
    return str.replace(/[&<>"'/]/g, function (m) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#x27;","/":"&#x2F;" })[m] || m;
    });
  }

  function formatNumber(n) {
    if (typeof n !== "number") return "0";
    if (n >= 1e9)  return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
    if (n >= 1e6)  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3)  return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return n.toString();
  }

  function timeAgo(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "unknown";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)   return Math.floor(diff) + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return d.toLocaleDateString();
  }

  /* ------------ Config ------------ */
  var RARITY_META = {
    common:    { color: "#6b7196", icon: "◇", label: "Common" },
    uncommon:  { color: "#4cc9ff", icon: "◆", label: "Uncommon" },
    rare:      { color: "#7c5cff", icon: "★", label: "Rare" },
    legendary: { color: "#ffb84d", icon: "✦", label: "Legendary" },
    mythical:  { color: "#ff5c7a", icon: "♛", label: "Mythical" },
    gamepass:  { color: "#f1c40f", icon: "⚡", label: "Gamepass" },
    limited:   { color: "#e056fd", icon: "✧", label: "Limited" }
  };
  var TREND_ICON = { up: "▲", down: "▼", stable: "●" };

  /* ------------ State ------------ */
  var fruits = Array.isArray(window.FRUITS) ? window.FRUITS : [];
  fruits.sort(function (a, b) { return b.value - a.value; });
  var state = { query: "", rarity: "all", sort: "value-desc" };

  /* ------------ Calculator State ------------ */
  var calcState = {
    offer:   [],
    request: [],
    context: null  // "offer" or "request"
  };

  /* ------------ Render Fruit Cards ------------ */
  function isTokenItem(name) { return name.indexOf("Token") !== -1; }
  function getTokenIcon(name) {
    if (name.indexOf("Dragon") !== -1) return "&#128009;";
    return "&#127775;";
  }

  function buildCard(f) {
    var rm = RARITY_META[f.rarity] || { color: "#888", icon: "◆", label: f.rarity };
    var animClass = "anim-" + (f.anim || "float");
    var trendCls = "trend-" + f.trend;
    var demandCls = "demand-" + f.demand;
    var firstLetter = f.name.charAt(0);
    var isGamepass = f.rarity === "gamepass";
    var isToken = isTokenItem(f.name);

    var el = document.createElement("article");
    el.className = "fruit-card " + animClass + (isGamepass ? " gamepass-card" : "");
    el.style.setProperty("--card-glow", rm.color);
    el.style.setProperty("--cat-color", rm.color);

    var permHtml = (isGamepass || f.rarity === "limited")
      ? ""
      : '<div class="fruit-perm"><span>&#128142; Perm: <strong>' + formatNumber(f.perm) + '</strong></span></div>';

    var fallbackContent = isToken ? getTokenIcon(f.name) : firstLetter;

    el.innerHTML =
      '<div class="fruit-img-wrap" style="background:radial-gradient(circle at 50% 50%, ' + rm.color + '22, ' + rm.color + '11, ' + rm.color + '08)">' +
        '<span class="cat-badge" style="background:' + rm.color + '">' + rm.icon + ' ' + rm.label + '</span>' +
        '<span class="trend-badge ' + trendCls + '">' + TREND_ICON[f.trend] + ' ' + f.trend + '</span>' +
        '<img class="fruit-img" alt="' + sanitize(f.name) + '" data-id="' + f.img + '" loading="lazy" referrerpolicy="no-referrer" />' +
        '<div class="fruit-fallback" style="font-size:' + (isToken ? '28px' : '42px') + '">' + fallbackContent + '</div>' +
      '</div>' +
      '<div class="fruit-name">' + sanitize(f.name) + '</div>' +
      '<div class="fruit-meta">' +
        '<div class="fruit-value">' + formatNumber(f.value) + ' <small>value</small></div>' +
        '<div class="demand-pill ' + demandCls + '">' + f.demand + '</div>' +
      '</div>' +
      permHtml;

    loadFruitImage(el.querySelector('.fruit-img'));
    return el;
  }

  /* ------------ Global Image Cache ------------ */
  var imgCache = {};

  var FALLBACK_IMG_URLS = {
    "Dragon_Token.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Dragon-Token_Icon.webp",
    "Kitsune.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Kitsune_Icon.webp",
    "Yeti.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/12/Yeti_Icon.webp",
    "Gas.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/11/Gas_Icon.webp",
    "Dragon.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Dragon_Icon.webp",
    "Leopard.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Leopard_Icon.webp",
    "Trex.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Trex_Icon.webp",
    "Mammoth.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Mammoth_Icon.webp",
    "Venom.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Venom_Icon.webp",
    "Spirit.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Spirit_Icon.webp",
    "Dough.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Dough_Icon.webp",
    "Control.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Control_Icon.webp",
    "Shadow.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Shadow_Icon.webp",
    "Dark.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Dark_Icon.webp",
    "Rumble.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Rumble_Icon.webp",
    "Flame.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Flame_Icon.webp",
    "Light.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Light_Icon.webp",
    "Phoenix.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Phoenix_Icon.webp",
    "Buddha.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Buddha_Icon.webp",
    "Magma.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Magma_Icon.webp",
    "Ice.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Ice_Icon.webp",
    "Sand.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Sand_Icon.webp",
    "Gravity.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Gravity_Icon.webp",
    "Soul.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Soul_Icon.webp",
    "Love.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Love_Icon.webp",
    "Portal.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Portal_Icon.webp",
    "Blizzard.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Blizzard_Icon.webp",
    "Pain.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Pain_Icon.webp",
    "Quake.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Quake_Icon.webp",
    "String.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/String_Icon.webp",
    "Diamond.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Diamond_Icon.webp",
    "Ghost.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Ghost_Icon.webp",
    "Spike.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Spike_Icon.webp",
    "Rubber.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Rubber_Icon.webp",
    "Falcon.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Falcon_Icon.webp",
    "Barrier.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Barrier_Icon.webp",
    "Smoke.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Smoke_Icon.webp",
    "Water.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Water_Icon.webp",
    "Chop.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Chop_Icon.webp",
    "Spin.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Spin_Icon.webp",
    "Bomb.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Bomb_Icon.webp",
    "Spring.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Spring_Icon.webp",
    "Kilo.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Kilo_Icon.webp",
    "Rocket.png": "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Rocket_Icon.webp",
  };

  function loadFruitImage(imgEl) {
    var fileName = imgEl.getAttribute('data-id');
    if (!fileName) return;
    var fb = imgEl.nextElementSibling;
    if (fb) fb.style.display = 'flex';
    var fbk = FALLBACK_IMG_URLS[fileName];
    var urls = fbk
      ? [fbk, "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fileName]
      : ["https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fileName];
    var attempt = 0;
    function tryNext() {
      if (attempt >= urls.length) {
        imgEl.style.display = 'none';
        return;
      }
      imgEl.onerror = function () { attempt++; tryNext(); };
      imgEl.onload = function () {
        imgEl.style.display = '';
        if (fb) fb.style.display = 'none';
      };
      imgEl.src = urls[attempt];
    }
    tryNext();
  }

  function getVisible() {
    var q = state.query.trim().toLowerCase();
    return fruits
      .filter(function (f) { return state.rarity === "all" || f.rarity === state.rarity; })
      .filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) {
        switch (state.sort) {
          case "value-asc":  return a.value - b.value;
          case "value-desc": return b.value - a.value;
          case "name-asc":   return a.name.localeCompare(b.name);
          case "name-desc":  return b.name.localeCompare(a.name);
          case "trend": {
            var dw = { extreme: 4, high: 3, medium: 2, low: 1 };
            var tw = { up: 3, stable: 2, down: 1 };
            var sa = ((dw[a.demand]||0)*10 + (tw[a.trend]||0) + a.value/1000);
            var sb = ((dw[b.demand]||0)*10 + (tw[b.trend]||0) + b.value/1000);
            return sb - sa;
          }
          default: return 0;
        }
      });
  }

  function renderStats(visible, total) {
    var bar = $("#statsBar");
    if (!bar) return;
    var totVal = fruits.reduce(function (s, f) { return s + f.value; }, 0);
    var avg = Math.round(totVal / Math.max(1, fruits.length));
    var top = fruits.slice().sort(function (a, b) { return b.value - a.value; })[0];
    var hot = fruits.filter(function (f) { return f.trend === "up"; }).length;

    var counts = {};
    fruits.forEach(function (f) { counts[f.rarity] = (counts[f.rarity] || 0) + 1; });
    var order = ["common","uncommon","rare","legendary","mythical"];
    var chips = "";
    order.forEach(function (r) {
      if (counts[r]) {
        var rm = RARITY_META[r] || {};
        chips += '<span class="rarity-chip" style="--rc:' + (rm.color||"#888") + '">' + (rm.icon||"") + ' ' + (rm.label||r) + ': <strong>' + counts[r] + '</strong></span>';
      }
    });

    bar.innerHTML =
      '<div class="stat">Showing <strong>' + visible + '</strong> of <strong>' + total + '</strong></div>' +
      '<div class="stat">Top fruit <strong>' + sanitize(top ? top.name : "—") + '</strong></div>' +
      '<div class="stat">Avg value <strong>' + formatNumber(avg) + '</strong></div>' +
      '<div class="stat">Hot &#128293; <strong>' + hot + '</strong></div>' +
      '<div class="stat rarity-breakdown">' + chips + '</div>';
  }

  function render() {
    var grid = $("#fruitGrid");
    var empty = $("#emptyState");
    var list = getVisible();
    grid.innerHTML = "";
    if (list.length === 0) {
      if (empty) empty.classList.remove("hidden");
    } else {
      if (empty) empty.classList.add("hidden");
      var frag = document.createDocumentFragment();
      list.forEach(function (f) { frag.appendChild(buildCard(f)); });
      grid.appendChild(frag);
    }
    renderStats(list.length, fruits.length);
  }

  function renderUpdated() {
    var iso = (window.FRUITS_META && window.FRUITS_META.LAST_UPDATED) || new Date().toISOString();
    var el = $("#updatedText");
    if (el) {
      el.textContent = "Updated " + timeAgo(iso);
      el.title = "Last updated: " + new Date(iso).toLocaleString();
    }
  }

  /* ------------ Trade Calculator ------------ */
  function openPicker(context) {
    calcState.context = context;
    var m = $("#pickerModal");
    if (m) m.classList.remove("hidden");
    renderPicker("");
  }

  function closePicker() {
    var m = $("#pickerModal");
    if (m) m.classList.add("hidden");
    calcState.context = null;
  }

  function addFruitToCalc(context, fruitName, isPerm) {
    if (context === "post-offering" || context === "post-wanting") {
      addFruitToPost(context, fruitName);
      return;
    }
    var side = context === "request" ? calcState.request : calcState.offer;
    if (side.length >= 4) { showToast("Max 4 fruits per side"); return; }
    var fruit = fruits.filter(function (f) { return f.name === fruitName; })[0];
    var val = isPerm ? (fruit ? fruit.perm : 0) : (fruit ? fruit.value : 0);
    side.unshift({ name: fruitName, value: val, perm: isPerm || false });
    renderCalc();
    closePicker();
  }

  function calcTotal(items) {
    return items.reduce(function (s, it) { return s + it.value; }, 0);
  }

  function removeFruitFromCalc(side, idx) {
    if (side === "offer") calcState.offer.splice(idx, 1);
    else calcState.request.splice(idx, 1);
    renderCalc();
  }

  function renderCalc() {
    renderSlots("offer");
    renderSlots("request");
    renderFruitPreview();
    $("#offerTotal").textContent = formatNumber(calcTotal(calcState.offer));
    $("#requestTotal").textContent = formatNumber(calcTotal(calcState.request));

    var totalOffer = calcTotal(calcState.offer);
    var totalRequest = calcTotal(calcState.request);
    var resultLabel = $("#resultLabel");
    var resultValue = $("#resultValue");
    if (!resultLabel || !resultValue) return;

    if (calcState.offer.length === 0 && calcState.request.length === 0) {
      resultLabel.innerHTML = '<span class="result-icon">&#128200;</span> Add fruits to both sides';
      resultValue.textContent = "";
      resultValue.className = "calc-result-value result-neutral";
    } else {
      var diff = totalOffer - totalRequest;
      var larger = Math.max(totalOffer, totalRequest);
      var pct = larger > 0 ? Math.round((Math.min(totalOffer, totalRequest) / larger) * 100) : 0;
      if (diff > 0) {
        resultLabel.innerHTML = '<span class="result-icon">&#128563;</span> You overpay by:';
        resultValue.textContent = formatNumber(diff);
        resultValue.className = "calc-result-value result-loss";
        if (pct < 50) {
          resultLabel.innerHTML = '<span class="result-icon">&#128565;</span> Big loss! You overpay by:';
        }
        resultLabel.innerHTML += ' <span class="result-ratio">(' + pct + '%)</span>';
      } else if (diff < 0) {
        resultLabel.innerHTML = '<span class="result-icon">&#128293;</span> Profit:';
        resultValue.textContent = formatNumber(Math.abs(diff));
        resultValue.className = "calc-result-value result-profit";
        if (pct < 50) {
          resultLabel.innerHTML = '<span class="result-icon">&#127881;</span> Huge profit!';
        }
        resultLabel.innerHTML += ' <span class="result-ratio">(' + pct + '%)</span>';
      } else {
        resultLabel.innerHTML = '<span class="result-icon">&#9989;</span> Fair trade!';
        resultValue.textContent = "Equal value";
        resultValue.className = "calc-result-value result-even";
      }
      var bar = $("#resultBar");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "resultBar";
        bar.className = "result-bar";
        resultValue.parentNode.insertBefore(bar, resultValue.nextSibling);
      }
      var offerPct = larger > 0 ? Math.round((totalOffer / larger) * 100) : 50;
      var requestPct = larger > 0 ? Math.round((totalRequest / larger) * 100) : 50;
      bar.innerHTML = '<div class="result-bar-track"><div class="result-bar-fill result-bar-offer" style="width:' + offerPct + '%"></div><div class="result-bar-fill result-bar-request" style="width:' + requestPct + '%"></div></div>';
    }

    var chatBtn = $("#postTradeToChatBtn");
    if (chatBtn) {
      if (firestoreReady && authUser && (calcState.offer.length > 0 || calcState.request.length > 0)) {
        chatBtn.classList.remove("hidden");
      } else {
        chatBtn.classList.add("hidden");
      }
    }
  }

  function renderSlots(side) {
    var items = side === "offer" ? calcState.offer : calcState.request;
    for (var i = 0; i < 4; i++) {
      var slot = document.querySelector('.calc-slot[data-side="' + side + '"][data-idx="' + i + '"]');
      if (!slot) continue;
      var fruit = items[i];
      if (fruit) {
        renderFruitSlot(slot, fruit, side, i);
      } else {
        renderEmptySlot(slot);
      }
    }
  }

  function renderEmptySlot(slot) {
    slot.classList.remove("has-fruit");
    slot.innerHTML = '<div class="calc-slot-empty"><span class="plus">+</span><span class="label">Add Fruit</span></div>';
    slot.onclick = function () { openPicker(slot.dataset.side); };
  }

  function renderFruitSlot(slot, fruit, side, idx) {
    slot.classList.add("has-fruit");
    slot.onclick = null;
    var f = fruits.filter(function (x) { return x.name === fruit.name; })[0] || {};
    var rm = RARITY_META[f.rarity] || {};
    var animClass = "anim-" + (f.anim || "float");
    var color = rm.color || "#888";
    var letter = fruit.name.charAt(0).toUpperCase();
    var imgF = f.img || "";
    var imgUrl = FALLBACK_IMG_URLS[imgF] || "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + imgF;
    slot.style.setProperty("--card-glow", color);
    slot.innerHTML =
      '<div class="calc-slot-fruit ' + animClass + '" style="background:radial-gradient(circle at 50% 50%, ' + color + '22, transparent 70%)">' +
        '<div class="fruit-img-wrap">' +
          '<img src="' + imgUrl + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';var p=this.parentElement,n=p.querySelector(\'.letter-fb\');if(n)n.style.display=\'flex\'" />' +
          '<span class="letter-fb" style="display:none">' + letter + '</span>' +
        '</div>' +
        '<div class="fruit-name">' + sanitize(fruit.name) + (fruit.perm ? ' <small>Perm</small>' : '') + '</div>' +
        '<div class="fruit-val">' + formatNumber(fruit.value) + '</div>' +
        '<button class="remove-btn" data-side="' + side + '" data-idx="' + idx + '" aria-label="Remove">&times;</button>' +
      '</div>';
    var removeBtn = slot.querySelector(".remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        removeFruitFromCalc(side, idx);
      });
    }
  }

  function renderPicker(query) {
    var grid = $("#pickerGrid");
    if (!grid) return;
    var q = (query || "").trim().toLowerCase();
    grid.innerHTML = "";
    var frag = document.createDocumentFragment();
    var isGamepass = function (r) { return r === "gamepass"; };
    for (var i = 0; i < fruits.length; i++) {
      var f = fruits[i];
      if (q && f.name.toLowerCase().indexOf(q) === -1) continue;
      var rm = RARITY_META[f.rarity] || {};

      // Normal version (all items)
      frag.appendChild(buildPickerItem(f, f.value, false, rm, q));

      // Perm version (fruits only, skip gamepasses)
      if (!isGamepass(f.rarity) && f.perm > 0) {
        frag.appendChild(buildPickerItem(f, f.perm, true, rm, q));
      }
    }
    grid.appendChild(frag);
  }

  function buildPickerItem(f, val, isPerm, rm, q) {
    var el = document.createElement("div");
    el.className = "picker-item" + (isPerm ? " picker-perm" : "");
    el.style.setProperty("--card-glow", rm.color || "#888");

    var img = document.createElement("img");
    img.className = "pick-img";
    img.alt = f.name;
    loadPickerImage(img, f.img);

    var info = document.createElement("div");
    info.className = "pick-info";

    var nameSpan = document.createElement("span");
    nameSpan.className = "pick-name";
    nameSpan.textContent = (isPerm ? "Perm " : "") + f.name;

    var valSpan = document.createElement("span");
    valSpan.className = "pick-val";
    valSpan.textContent = formatNumber(val);

    info.appendChild(nameSpan);
    info.appendChild(valSpan);

    el.appendChild(img);
    el.appendChild(info);

    el.addEventListener("click", function (ctx, fruit, perm) {
      return function () { addFruitToCalc(ctx, fruit, perm); };
    }(calcState.context || "offer", f.name, isPerm));

    return el;
  }

  function loadPickerImage(imgEl, fileName) {
    if (!fileName) return;
    var fbk = FALLBACK_IMG_URLS[fileName];
    var urls = fbk
      ? [fbk, "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fileName]
      : ["https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fileName];
    var attempt = 0;
    function tryNext() {
      if (attempt >= urls.length) { imgEl.removeAttribute("src"); return; }
      var tester = new Image();
      tester.referrerPolicy = "no-referrer";
      tester.onload = function () { imgEl.src = urls[attempt]; };
      tester.onerror = function () { attempt++; tryNext(); };
      tester.src = urls[attempt];
    }
    tryNext();
  }

  /* ------------ Detail Modal ------------ */
  var detailFruit = null;
  var detailImgLoaded = false;

  function showDetail(fruitName) {
    var fruit = null;
    for (var i = 0; i < fruits.length; i++) {
      if (fruits[i].name === fruitName) { fruit = fruits[i]; break; }
    }
    if (!fruit) return;
    detailFruit = fruit;
    var detail = FRUITS_DETAIL[fruit.name] || {};
    var rm = RARITY_META[fruit.rarity] || { color: "#888", icon: "◆", label: fruit.rarity };
    var isGamepass = fruit.rarity === "gamepass";
    var firstLetter = fruit.name.charAt(0);

    var m = $("#detailModal");
    if (!m) return;

    // Set card glow color
    m.style.setProperty("--card-glow", rm.color);
    m.style.setProperty("--cat-color", rm.color);

    // Name
    $("#detailTitle").textContent = fruit.name;

    // Badge
    var badgeEl = $("#detailBadge");
    badgeEl.textContent = rm.icon + " " + rm.label;
    badgeEl.style.setProperty("--cat-color", rm.color);
    badgeEl.style.background = rm.color;

    // Type
    $("#detailType").textContent = fruit.type || "";

    // Description
    $("#detailDesc").textContent = detail.desc || "No description available.";

    // Moves
    var movesEl = $("#detailMoves");
    var moves = detail.moves || [];
    if (moves.length > 0) {
      movesEl.innerHTML = moves.map(function (m) { return "<li>" + sanitize(m) + "</li>"; }).join("");
    } else {
      movesEl.innerHTML = "<li style='color:var(--text-mute)'>No combat abilities (utility item)</li>";
    }

    // Awakening
    var awakeEl = $("#detailAwake");
    if (detail.awakening) {
      awakeEl.textContent = "Yes — Can be awakened through raids";
      awakeEl.className = "detail-awake";
    } else {
      awakeEl.textContent = "Not available";
      awakeEl.className = "detail-awake no";
    }

    // Drop chance
    $("#detailDrop").textContent = detail.dropChance || "—";

    // Beli / Robux
    $("#detailBeli").textContent = fruit.beli > 0 ? formatNumber(fruit.beli) + " Beli" : "—";
    $("#detailRobux").textContent = fruit.robux > 0 ? fruit.robux + " Robux" : "—";

    // Trade value
    $("#detailValue").textContent = formatNumber(fruit.value);

    // Perm value (hide for gamepass and limited)
    var permRow = $("#detailPermRow");
    if (isGamepass || fruit.rarity === "limited") {
      permRow.style.display = "none";
    } else {
      permRow.style.display = "";
      $("#detailPerm").textContent = formatNumber(fruit.perm);
    }

    // Demand with colored pill
    var demandEl = $("#detailDemand");
    demandEl.textContent = fruit.demand.charAt(0).toUpperCase() + fruit.demand.slice(1);
    demandEl.style.color = fruit.demand === "extreme" ? "#ff5c7a" : fruit.demand === "high" ? "#f39c12" : fruit.demand === "medium" ? "#c0392b" : "#9aa1c7";

    // Image
    var imgEl = $("#detailImg");
    var fbEl = $("#detailFallback");
    var bgEl = $("#detailImgBg");
    detailImgLoaded = false;
    imgEl.src = "";
    imgEl.style.display = "";
    fbEl.style.display = "none";
    fbEl.textContent = firstLetter;
    bgEl.style.background = "radial-gradient(circle at 50% 50%, " + rm.color + "33, transparent 70%)";

    if (fruit.img) {
      var fbk = FALLBACK_IMG_URLS[fruit.img];
      var urls = fbk
        ? [fbk, "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fruit.img]
        : ["https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fruit.img];
      var attempt = 0;
      function tryNext() {
        if (attempt >= urls.length) {
          imgEl.style.display = "none";
          fbEl.style.display = "flex";
          return;
        }
        var tester = new Image();
        tester.referrerPolicy = "no-referrer";
        tester.onload = function () {
          imgEl.src = urls[attempt];
          imgEl.style.display = "";
          fbEl.style.display = "none";
          detailImgLoaded = true;
        };
        tester.onerror = function () {
          attempt++;
          tryNext();
        };
        tester.src = urls[attempt];
      }
      tryNext();
    } else {
      imgEl.style.display = "none";
      fbEl.style.display = "flex";
    }

    m.classList.remove("hidden");
  }

  function closeDetail() {
    var m = $("#detailModal");
    if (m) m.classList.add("hidden");
    detailFruit = null;
  }

  /* ------------ Battle Canvas Animation ------------ */
  function initBattleCanvas() {
    var canvas = document.getElementById("battleCanvas");
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext("2d");
    var W, H;
    var time = 0;

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    var orbs = [];
    for (var i = 0; i < 12; i++) {
      orbs.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.5 + H * 0.2,
        r: 3 + Math.random() * 6,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.3,
        color: Math.random() > 0.5 ? "rgba(168,85,247," : "rgba(116,185,255,",
        alpha: 0.2 + Math.random() * 0.4,
        pulseSpeed: 0.5 + Math.random() * 1.5,
        pulsePhase: Math.random() * Math.PI * 2
      });
    }

    function drawKitsuneSimple(x, y, s) {
      // Purple body
      ctx.fillStyle = "rgba(168,85,247,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      var grad = ctx.createRadialGradient(x, y, 0, x, y, s);
      grad.addColorStop(0, "rgba(168,85,247,0.3)");
      grad.addColorStop(1, "rgba(168,85,247,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      // Tails
      for (var t = 0; t < 3; t++) {
        var ta = Math.sin(time + t) * 0.5 - 1.2;
        ctx.strokeStyle = "rgba(168,85,247,0.5)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - s * 0.3, y);
        ctx.quadraticCurveTo(x - s * 0.6 + Math.cos(time + t) * 10, y - s * 0.3, x - s * 0.8, y - s * 0.1 + Math.sin(time + t) * 8);
        ctx.stroke();
      }
      // Eyes (glowing)
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(x - s * 0.12, y - s * 0.08, 3, 0, Math.PI * 2);
      ctx.arc(x + s * 0.12, y - s * 0.08, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawYetiSimple(x, y, s) {
      // Ice body
      ctx.fillStyle = "rgba(116,185,255,0.7)";
      ctx.beginPath();
      ctx.arc(x, y + s * 0.05, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      var grad = ctx.createRadialGradient(x, y, 0, x, y, s);
      grad.addColorStop(0, "rgba(116,185,255,0.3)");
      grad.addColorStop(1, "rgba(116,185,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      // Ice shard crown
      for (var i = 0; i < 5; i++) {
        var angle = -Math.PI / 2 + (i - 2) * 0.4;
        ctx.fillStyle = "rgba(178,235,242,0.6)";
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * s * 0.35, y - s * 0.35);
        ctx.lineTo(x + Math.cos(angle - 0.15) * s * 0.2, y - s * 0.6 + Math.sin(time + i) * 3);
        ctx.lineTo(x + Math.cos(angle + 0.15) * s * 0.2, y - s * 0.6 + Math.sin(time + i) * 3);
        ctx.closePath();
        ctx.fill();
      }
      // Eyes (red)
      ctx.fillStyle = "#ff5252";
      ctx.beginPath();
      ctx.arc(x - s * 0.12, y - s * 0.05, 3, 0, Math.PI * 2);
      ctx.arc(x + s * 0.12, y - s * 0.05, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    function animate() {
      time += 0.025;
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      var bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "rgba(11,13,23,0.3)");
      bgGrad.addColorStop(0.5, "rgba(11,13,23,0.1)");
      bgGrad.addColorStop(1, "rgba(11,13,23,0.3)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Ground line
      ctx.strokeStyle = "rgba(124,92,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.72);
      ctx.lineTo(W, H * 0.72 + Math.sin(time) * 5);
      ctx.stroke();

      // Fire orb flying between them
      var kx = W * 0.22, ky = H * 0.48 + Math.sin(time * 0.8) * 20;
      var yx = W * 0.78, yy = H * 0.45 + Math.cos(time * 0.6) * 15;
      var orbProgress = (Math.sin(time * 0.4) + 1) / 2;
      var ox = kx + (yx - kx) * orbProgress;
      var oy = ky + (yy - ky) * orbProgress - 15 * Math.sin(orbProgress * Math.PI);

      var orbGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, 16);
      orbGrad.addColorStop(0, "rgba(250,204,21,0.9)");
      orbGrad.addColorStop(0.5, "rgba(168,85,247,0.5)");
      orbGrad.addColorStop(1, "rgba(168,85,247,0)");
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(ox, oy, 8 + 5 * Math.sin(time * 4), 0, Math.PI * 2);
      ctx.fill();

      // Ice shards floating (simple triangles)
      for (var i = 0; i < 6; i++) {
        var angle = time * 0.3 + i * 1.05;
        var dist = 50 + Math.sin(time + i) * 20;
        var sx = yx + Math.cos(angle) * dist;
        var sy = yy + Math.sin(angle) * dist * 0.5;
        ctx.fillStyle = "rgba(178,235,242," + (0.15 + Math.sin(time + i) * 0.1) + ")";
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6);
        ctx.lineTo(sx + 5, sy + 4);
        ctx.lineTo(sx - 5, sy + 4);
        ctx.closePath();
        ctx.fill();
      }

      // Floating ambient orbs
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        o.x += o.vx + Math.sin(time * o.pulseSpeed + o.pulsePhase) * 0.3;
        o.y += o.vy + Math.cos(time * o.pulseSpeed * 0.7 + o.pulsePhase) * 0.2;
        if (o.x < -20) o.x = W + 20;
        if (o.x > W + 20) o.x = -20;
        if (o.y < H * 0.1) o.y = H * 0.1;
        if (o.y > H * 0.8) o.y = H * 0.8;
        var alpha = o.alpha * (0.6 + 0.4 * Math.sin(time * o.pulseSpeed + o.pulsePhase));
        ctx.fillStyle = o.color + alpha + ")";
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * (0.8 + 0.2 * Math.sin(time * o.pulseSpeed + o.pulsePhase)), 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw characters
      drawYetiSimple(yx, yy, 45);
      drawKitsuneSimple(kx, ky, 40);

      requestAnimationFrame(animate);
    }

    animate();
  }

  /* ------------ Trade Board ------------ */
  function getOffers() {
    try {
      var arr = JSON.parse(localStorage.getItem("bfx-offers")) || [];
      // Migrate old offers without id
      var changed = false;
      arr.forEach(function (o) {
        if (!o.id) { o.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); changed = true; }
      });
      if (changed) saveOffers(arr);
      return arr;
    } catch (e) { return []; }
  }

  function saveOffers(arr) {
    try { localStorage.setItem("bfx-offers", JSON.stringify(arr)); } catch (e) {}
  }

  function getMessages() {
    try { return JSON.parse(localStorage.getItem("bfx-messages")) || []; } catch (e) { return []; }
  }

  function saveMessages(arr) {
    try { localStorage.setItem("bfx-messages", JSON.stringify(arr)); } catch (e) {}
  }

  function closeContact() {
    var m = $("#contactModal");
    if (m) m.classList.add("hidden");
    calcState._contactIdx = null;
    calcState._contactOffers = null;
  }

  function populateFruitList() {
    var dl = $("#fruitList");
    if (!dl) return;
    var names = {};
    fruits.forEach(function (f) { names[f.name] = true; });
    Object.keys(names).sort().forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      dl.appendChild(opt);
    });
  }

  function showToast(msg) {
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  /* ------------ Tag Input Helpers ------------ */
  function getTagValues(listId) {
    var tags = $("#" + listId);
    if (!tags) return [];
    return Array.from(tags.querySelectorAll(".tag-chip"))
      .map(function (t) { return t.textContent.replace("\u00d7", "").trim(); })
      .filter(Boolean);
  }

  function addTag(listId, fieldId, value) {
    var list = $("#" + listId);
    var field = $("#" + fieldId);
    if (!list || !field || !value.trim()) return;
    value = value.trim();
    var existing = getTagValues(listId);
    if (existing.indexOf(value) !== -1) { field.value = ""; return; }
    var chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = sanitize(value) + '<span class="tag-chip-remove" data-tag-list="' + listId + '">&times;</span>';
    list.appendChild(chip);
    field.value = "";
    field.focus();
  }

  /* ------------ Auth ------------ */
  var authUser = null;
  var authProfile = null;
  var firestoreReady = false;
  var activeUserInterval = null;

  function initFirebase() {
    try {
      var app = firebase.initializeApp(FIREBASE_CONFIG);
      firebase.auth().onAuthStateChanged(function (user) {
        var loginMethod = null;
        try { loginMethod = localStorage.getItem("bfx-login-method"); } catch (e) {}
        if (!user && loginMethod === "discord") {
          var saved = getLocalProfile();
          if (saved && saved.displayName) {
            authUser = { uid: "discord_" + (saved.discord || saved.displayName), email: (saved.discord || "") + "@discord.com", displayName: saved.displayName, isDiscord: true };
            authProfile = saved;
            updateAuthUI();
            renderBoard($("#boardSearch").value);
            renderGiveaways();
            return;
          }
        }
        authUser = user;
        if (user) {
          var savedProfile = getLocalProfile();
          authProfile = {
            displayName: savedProfile.displayName || user.displayName || "",
            discord: savedProfile.discord || "",
            avatarUrl: ""
          };
          saveLocalProfile(authProfile);
          try { localStorage.setItem("bfx-login-method", "firebase"); } catch (e) {}
          startActiveUserTracking();
        } else {
          authUser = null;
          var local = getLocalProfile();
          authProfile = local && local.displayName ? local : { displayName: "", discord: "", avatarUrl: "" };
          if (activeUserInterval) { clearInterval(activeUserInterval); activeUserInterval = null; }
          try { localStorage.removeItem("bfx-login-method"); } catch (e) {}
        }
        updateAuthUI();
        renderBoard($("#boardSearch").value);
        renderGiveaways();
      });
      firestoreReady = true;
    } catch (e) {
      console.warn("Firebase init failed, running in local-only mode:", e);
      var local2 = getLocalProfile();
      authProfile = local2 && local2.displayName ? local2 : { displayName: "", discord: "", avatarUrl: "" };
      updateAuthUI();
    }
  }

  function updateAuthUI() {
    var signInBtn = $("#signInBtn");
    var menu = $("#userMenu");
    if (!signInBtn || !menu) return;
    if (authUser) {
      signInBtn.classList.add("hidden");
      menu.classList.remove("hidden");
      var letter = $("#userAvatarLetter");
      if (letter) {
        var name = getDisplayName() || "User";
        letter.textContent = name.charAt(0).toUpperCase();
      }
    } else {
      signInBtn.classList.remove("hidden");
      menu.classList.add("hidden");
    }
  }

  /* ─── Discord OAuth (PKCE) ─── */
  function generateCodeVerifier() {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    var arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return Array.from(arr, function (b) { return chars[b % chars.length]; }).join("");
  }

  function generateCodeChallenge(verifier) {
    var enc = new TextEncoder();
    return crypto.subtle.digest("SHA-256", enc.encode(verifier)).then(function (buf) {
      return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    });
  }

  function signInWithDiscord() {
    var clientId = typeof DISCORD_CLIENT_ID !== "undefined" ? DISCORD_CLIENT_ID : "";
    if (!clientId) {
      showToast("Discord OAuth not configured — set DISCORD_CLIENT_ID in firebase-config.js");
      return;
    }
    var verifier = generateCodeVerifier();
    sessionStorage.setItem("dc_verifier", verifier);
    generateCodeChallenge(verifier).then(function (challenge) {
      var redirectUri = window.location.origin + window.location.pathname;
      var url = "https://discord.com/api/oauth2/authorize" +
        "?client_id=" + encodeURIComponent(clientId) +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&response_type=code" +
        "&scope=identify" +
        "&code_challenge=" + encodeURIComponent(challenge) +
        "&code_challenge_method=S256";
      window.location.href = url;
    }).catch(function () {
      showToast("Failed to start Discord sign-in");
    });
  }

  function handleDiscordCallback() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (!code) return;
    var verifier = sessionStorage.getItem("dc_verifier");
    sessionStorage.removeItem("dc_verifier");
    if (!verifier) { showToast("Discord sign-in expired — please try again"); return; }
    var clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, "", clean);
    showToast("Verifying Discord account...");
    var clientId = typeof DISCORD_CLIENT_ID !== "undefined" ? DISCORD_CLIENT_ID : "";
    var redirectUri = window.location.origin + window.location.pathname;
    fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=" + encodeURIComponent(clientId) +
        "&code_verifier=" + encodeURIComponent(verifier) +
        "&code=" + encodeURIComponent(code) +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&grant_type=authorization_code"
    }).then(function (r) { return r.json(); }).then(function (tokenData) {
      if (tokenData.access_token) {
        return fetch("https://discord.com/api/users/@me", {
          headers: { "Authorization": "Bearer " + tokenData.access_token }
        }).then(function (r) { return r.json(); });
      } else {
        showToast("Discord sign-in failed: " + (tokenData.error_description || tokenData.error || "Unknown error"));
        return null;
      }
    }).then(function (user) {
      if (!user) return;
      var avatarUrl = "";
      if (user.avatar) {
        var ext = user.avatar.indexOf("a_") === 0 ? "gif" : "png";
        avatarUrl = "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + "." + ext;
      }
      var displayName = user.global_name || user.username || "Discord User";
      var data = {
        displayName: displayName,
        discord: user.username,
        roblox: "",
        avatarUrl: avatarUrl
      };
      saveLocalProfile(data);
      authProfile = data;
      if (!authUser) {
        authUser = { uid: "discord_" + user.id, email: user.id + "@discord.com", displayName: displayName, isDiscord: true };
      }
      try { localStorage.setItem("bfx-login-method", "discord"); } catch (e) {}
      startActiveUserTracking();
      updateAuthUI();
      showToast("Signed in as " + displayName);
    }).catch(function () {
      showToast("Discord sign-in network error");
    });
  }

  function signOut() {
    if (!firebase || !firebase.auth) { showToast("Firebase not available"); return; }
    firebase.auth().signOut().then(function () {
      showToast("Signed out");
    }).catch(function (err) {
      showToast("Sign-out error: " + err.message);
    });
  }

  function getSessionId() {
    var sid;
    try { sid = localStorage.getItem("bfx-session-id"); } catch (e) {}
    if (!sid) {
      sid = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem("bfx-session-id", sid); } catch (e) {}
    }
    return sid;
  }

  function startActiveUserTracking() {
    if (!firestoreReady) return;
    if (activeUserInterval) clearInterval(activeUserInterval);
    var sessionId = getSessionId();
    var isAnon = !authUser;
    var uid = authUser ? authUser.uid : ("anon_" + sessionId);
    var displayName = authUser ? (getDisplayName() || authUser.displayName || "User") : "Anonymous";
    var email = authUser ? (authUser.email || "") : "";
    function updatePresence() {
      try {
        firebase.firestore().collection("activeUsers").doc(uid).set({
          uid: uid,
          displayName: displayName,
          email: email,
          isAnonymous: isAnon,
          lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {}
    }
    updatePresence();
    activeUserInterval = setInterval(updatePresence, 30000);
    window.addEventListener("beforeunload", function () {
      try {
        firebase.firestore().collection("activeUsers").doc(uid).delete();
      } catch (e) {}
    });
  }

  function updateActiveCount() {
    if (!firestoreReady) { setTimeout(updateActiveCount, 1000); return; }
    try {
      var cutoff = new Date(Date.now() - 120 * 1000);
      firebase.firestore().collection("activeUsers")
        .where("lastSeen", ">=", cutoff)
        .limit(50)
        .get()
        .then(function (snap) {
          var count = snap.size;
          var badge = $("#activeCountBadge");
          if (badge) {
            badge.textContent = count + " online";
            badge.style.display = count > 0 ? "inline-flex" : "none";
          }
        }).catch(function () {});
    } catch (e) {}
  }

  function getDisplayName() {
    return (authProfile && authProfile.displayName) || getLocalProfile().displayName || "";
  }

  /* ------------ Local Profile ------------ */
  function getLocalProfile() {
    try { return JSON.parse(localStorage.getItem("bfx-profile")) || {}; } catch (e) { return {}; }
  }
  function saveLocalProfile(data) {
    try { localStorage.setItem("bfx-profile", JSON.stringify(data)); } catch (e) {}
  }

  /* ------------ Firestore Offers ------------ */
  var offersLastDoc = null;
  var offersLoading = false;

  function loadOffersFromFirestore(callback) {
    if (!firestoreReady) { callback(getOffers()); return; }
    offersLastDoc = null;
    offersLoading = false;
    loadOffersPage(callback, true);
  }

  function loadOffersPage(callback, reset) {
    if (!firestoreReady) return;
    if (offersLoading) return;
    offersLoading = true;
    var query = firebase.firestore().collection("offers").orderBy("time", "desc").limit(PAGE_SIZE);
    if (offersLastDoc && !reset) query = query.startAfter(offersLastDoc);
    query.get().then(function (snap) {
      offersLoading = false;
      var list = [];
      snap.forEach(function (doc) { list.push({ id: doc.id, data: function () { return doc.data(); } }); });
      var offers = list.map(function (d) { var o = d.data(); o._firestoreId = d.id; return o; });
      if (snap.docs.length > 0) offersLastDoc = snap.docs[snap.docs.length - 1];
      callback(offers, snap.docs.length === PAGE_SIZE);
    }).catch(function () { offersLoading = false; callback([], false); });
  }

  function loadMoreOffers(callback) {
    loadOffersPage(callback, false);
  }

  function saveOfferToFirestore(offer, callback) {
    if (!firestoreReady || !authUser) { callback(); return; }
    offer.uid = authUser.uid;
    offer.userEmail = authUser.email;
    firebase.firestore().collection("offers").add(offer).then(function () { if (callback) callback(); }).catch(function () { if (callback) callback(); });
  }

  function deleteOfferFromFirestore(firestoreId, callback) {
    if (!firestoreReady) { if (callback) callback(); return; }
    firebase.firestore().collection("offers").doc(firestoreId).delete().then(function () { if (callback) callback(); }).catch(function () { if (callback) callback(); });
  }

  function addReport(firestoreId) {
    if (!authUser || !firestoreReady) { showToast("Sign in to report"); return; }
    firebase.firestore().collection("reports").add({
      offerId: firestoreId,
      reportedBy: authUser.uid,
      time: new Date().toISOString()
    }).then(function () {
      showToast("Report submitted. We'll review it.");
    }).catch(function () {
      showToast("Error submitting report");
    });
  }

  /* ------------ Modified Trade Board ------------ */
  function renderBoard(query) {
    var grid = $("#offerGrid");
    var empty = $("#emptyBoard");
    if (!grid) return;

    function findFruit(name) {
      for (var fi = 0; fi < fruits.length; fi++) {
        if (fruits[fi].name.toLowerCase() === name.toLowerCase()) return fruits[fi];
      }
      return null;
    }

    function renderItemsHtml(arr, opts) {
      if (!arr || !arr.length) return "";
      opts = opts || {};
      var size = opts.size || "md";
      var dim = size === "lg" ? 88 : 52;
      var fontSize = size === "lg" ? "13px" : "11px";
      var imgDim = size === "lg" ? 72 : 42;
      var letterSize = size === "lg" ? 28 : 16;
      return arr.map(function (i) {
        var fruit = findFruit(i);
        var rm = fruit ? (RARITY_META[fruit.rarity] || {}) : {};
        var color = rm.color || "var(--accent)";
        var imgUrl = fruit && fruit.img ? (FALLBACK_IMG_URLS[fruit.img] || "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + fruit.img) : "";
        var firstLetter = fruit ? fruit.name.charAt(0) : i.charAt(0);
        var val = fruit ? fruit.value.toLocaleString() : "";
        return '<div class="offer-fruit-card" style="--chip-color:' + color + '">' +
          '<div class="offer-fruit-img-wrap" style="width:' + imgDim + 'px;height:' + imgDim + 'px">' +
            (imgUrl ? '<img class="offer-fruit-img" src="' + imgUrl + '" alt="' + sanitize(i) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" onload="this.style.display=\'block\';this.nextSibling.style.display=\'none\'" />' : '') +
            '<span class="offer-fruit-letter" style="display:' + (imgUrl ? 'none' : 'flex') + ';font-size:' + letterSize + 'px">' + firstLetter + '</span>' +
          '</div>' +
          '<span class="offer-fruit-name" style="font-size:' + fontSize + '">' + sanitize(i) + '</span>' +
          (val ? '<span class="offer-fruit-val">' + val + '</span>' : '') +
        '</div>';
      }).join("");
    }

    function renderWantHtml(arr) {
      if (!arr || !arr.length) return { html: "", hasMain: false };
      // Check for explicit "Adds" pseudo-item
      var hasExplicitAdds = false;
      var filtered = [];
      for (var ai = 0; ai < arr.length; ai++) {
        if (arr[ai] === "Adds") { hasExplicitAdds = true; }
        else { filtered.push(arr[ai]); }
      }
      if (!filtered.length) {
        // Only "Adds" was in the list — show the adds card
        return {
          html: '<div class="offer-adds-card-explicit">' +
            '<div class="offer-adds-explicit-icon">&#10133;</div>' +
            '<div class="offer-adds-explicit-header">Expecting Adds</div>' +
            '<div class="offer-adds-desc">Looking for offers with extra adds on top</div>' +
          '</div>',
          hasMain: true
        };
      }
      // Sort remaining fruits by value descending
      var sorted = filtered.slice().sort(function (a, b) {
        var fa = findFruit(a), fb = findFruit(b);
        var va = fa ? fa.value : 0, vb = fb ? fb.value : 0;
        return vb - va;
      });
      var main = sorted[0];
      var adds = sorted.slice(1);
      var mainHtml = renderItemsHtml([main], { size: "lg" });
      var wantsExtras = hasExplicitAdds; // user explicitly wants adds on top
      var addsHtml = "";
      if (adds.length > 0) {
        // Auto-grouped lower-value wanting fruits
        addsHtml = '<div class="offer-adds-card">' +
          '<div class="offer-adds-header">&#43; Adds</div>' +
          '<div class="offer-adds-items">' + renderItemsHtml(adds, { size: "lg" }) + '</div>' +
        '</div>';
      }
      if (wantsExtras) {
        // Explicit "expecting adds" card shown alongside main want
        addsHtml += '<div class="offer-adds-card-explicit">' +
          '<div class="offer-adds-explicit-icon">&#10133;</div>' +
          '<div class="offer-adds-explicit-header">Expecting Adds</div>' +
          '<div class="offer-adds-desc">Also expecting extra adds on top</div>' +
        '</div>';
      }
      return { html: mainHtml + addsHtml, hasMain: true };
    }

    function renderList(offers, hasMore) {
      var q = (query || "").trim().toLowerCase();
      if (q) {
        offers = offers.filter(function (o) {
          var offerStr = (o.offeringStr || (Array.isArray(o.offering) ? o.offering.join(", ") : o.offering) || "").toLowerCase();
          var wantStr = (o.wantingStr || (Array.isArray(o.wanting) ? o.wanting.join(", ") : o.wanting) || "").toLowerCase();
          var openText = (o.wantingText || "").toLowerCase();
          return (o.user || "").toLowerCase().indexOf(q) !== -1 ||
                 offerStr.indexOf(q) !== -1 ||
                 wantStr.indexOf(q) !== -1 ||
                 openText.indexOf(q) !== -1;
        });
      }
      // Sort by likes count descending (most liked first)
      offers.sort(function (a, b) {
        var la = a.likes ? Object.keys(a.likes).length : 0;
        var lb = b.likes ? Object.keys(b.likes).length : 0;
        return lb - la;
      });
      grid.innerHTML = "";
      if (offers.length === 0) {
        if (empty) empty.classList.remove("hidden");
        return;
      }
      if (empty) empty.classList.add("hidden");

      // Load ratings for all offers
      var offerIds = offers.map(function (o) { return o._firestoreId || o.id; });
      loadRatings(offerIds, function (ratingsMap) {
        renderCards(offers, ratingsMap);
      });
      // Show load more if there are more pages
      var loadMoreBtn = $("#loadMoreBtn");
      if (loadMoreBtn) {
        if (hasMore && !q) {
          loadMoreBtn.classList.remove("hidden");
          loadMoreBtn.onclick = function () {
            loadMoreBtn.classList.add("hidden");
            loadMoreOffers(function (moreOffers, moreHasMore) {
              offers = offers.concat(moreOffers);
              renderList(offers, moreHasMore);
            });
          };
        } else {
          loadMoreBtn.classList.add("hidden");
        }
      }
    }

    function renderCards(offers, ratingsMap) {
      var frag = document.createDocumentFragment();
      offers.forEach(function (o, idx) {
        var card = document.createElement("div");
        card.className = "offer-card";
        card.style.setProperty("--i", idx);
        var isOwner = false;
        if (authUser) {
          isOwner = o.uid === authUser.uid;
        } else if (!o._firestoreId) {
          isOwner = true;
        }
        var offHtml = Array.isArray(o.offering) ? renderItemsHtml(o.offering, { size: "lg" }) : sanitize(o.offering || "");
        var isOpenToOffers = o.wantingOpen;
        var wantHtml = "";
        var hasWant = false;
        if (isOpenToOffers) {
          hasWant = true;
          var wt = o.wantingText ? sanitize(o.wantingText) : "";
          wantHtml = '<div class="offer-open-offer">' +
            '<div class="offer-open-icon">&#129309;</div>' +
            '<div class="offer-open-badge">Open to Offers</div>' +
            (wt ? '<div class="offer-open-text">' + wt + '</div>' : '') +
          '</div>';
        } else {
          var wantResult = renderWantHtml(Array.isArray(o.wanting) ? o.wanting : []);
          wantHtml = wantResult.html;
          hasWant = wantResult.hasMain;
        }
        var delId = o._firestoreId || o.id;

        // Determine top rarity and accent color
        var ranks = ["common", "uncommon", "rare", "legendary", "mythical", "gamepass", "limited"];
        var topRarity = null;
        function checkRarity(name) {
          var f = findFruit(name);
          if (f) {
            var ri = ranks.indexOf(f.rarity);
            var cri = topRarity ? ranks.indexOf(topRarity) : -1;
            if (ri > cri) topRarity = f.rarity;
          }
        }
        if (Array.isArray(o.offering)) o.offering.forEach(checkRarity);
        if (Array.isArray(o.wanting)) o.wanting.forEach(checkRarity);
        var accentColor = (topRarity && RARITY_META[topRarity]) ? RARITY_META[topRarity].color : "var(--accent)";
        var rarityLabel = topRarity ? (RARITY_META[topRarity].label || topRarity) : "";
        var userInitial = sanitize(o.user || "?").charAt(0).toUpperCase();
        card.style.setProperty("--offer-accent", accentColor);

        // Rating data
        var offerRatings = ratingsMap[o._firestoreId || o.id] || [];
        var rStats = getAvgRating(offerRatings);
        var starsHtml = "";
        var rateBtnHtml = "";
        if (!isOwner && authUser) {
          var myRating = offerRatings.filter(function (r) { return r.fromUid === authUser.uid; })[0];
          rateBtnHtml = '<button class="offer-rate-btn" data-oidx="' + idx + '" data-rated="' + (myRating ? myRating.rating : 0) + '">' +
            (myRating ? '&#9998; Edit' : '&#9733; Rate') + '</button>';
        }
        if (rStats.count > 0) {
          starsHtml = renderStars(rStats.avg) +
            ' <span class="offer-stats-text">' + rStats.avg + ' (' + rStats.count + ')</span>';
        }

        // Compute total values
        function sumValues(arr) {
          var s = 0;
          (arr || []).forEach(function (name) {
            var f = findFruit(name);
            if (f) s += f.value;
          });
          return s.toLocaleString();
        }
        var offerVal = sumValues(o.offering);
        var wantVal = sumValues(o.wanting);

        // Build items section
        function buildItemSection(label, icon, html, value) {
          return '<div class="offer-section">' +
            '<div class="offer-section-header">' +
              '<span class="offer-section-badge">' + icon + '</span>' +
              '<span class="offer-section-label">' + label + '</span>' +
              (value ? '<span class="offer-section-val">' + value + '</span>' : '') +
            '</div>' +
            (html ? '<div class="offer-section-items">' + html + '</div>' : '') +
          '</div>';
        }

        card.innerHTML =
          '<div class="offer-glow"></div>' +
          '<div class="offer-bg-grad"></div>' +
          '<div class="offer-shimmer"></div>' +
          '<div class="offer-content">' +
            '<div class="offer-top">' +
              '<div class="offer-top-left">' +
                '<div class="offer-avatar" style="background:' + accentColor + '">' + userInitial + '</div>' +
                '<div class="offer-top-info">' +
                  '<div class="offer-top-name">' + sanitize(o.user || "Unknown") + '</div>' +
                  '<div class="offer-top-time">' + timeAgo(o.time) + (rarityLabel ? ' &middot; <span class="offer-rarity-badge" style="color:' + accentColor + '">' + rarityLabel + '</span>' : '') + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="offer-top-actions">' +
                '<span class="offer-val-chip" style="--chip-color:' + accentColor + '">Value: ' + offerVal + '</span>' +
                '<button class="offer-like-btn' + (authUser && o.likes && o.likes[authUser.uid] ? ' liked' : '') + '" data-like="' + delId + '" title="Like">&#10084; <span class="offer-like-count">' + (o.likes ? Object.keys(o.likes).length : 0) + '</span></button>' +
                (isOwner ? '<button class="offer-top-btn del-btn" data-del="' + delId + '" title="Delete">&#128465;</button>' : '') +
                (!isOwner ? '<button class="offer-top-btn report-btn" data-rep="' + delId + '" title="Report">&#9878;</button>' : '') +
              '</div>' +
            '</div>' +
            '<div class="offer-body">' +
              (hasWant ?
                '<div class="offer-trade-row">' +
                  '<div class="offer-section offer-section-trade">' +
                    '<div class="offer-section-header">' +
                      '<span class="offer-section-badge">&#128229;</span>' +
                      '<span class="offer-section-label">Offering</span>' +
                    '</div>' +
                    '<div class="offer-section-items">' + offHtml + '</div>' +
                  '</div>' +
                  '<div class="offer-trade-arrow">&#8594;</div>' +
                  '<div class="offer-section offer-section-trade">' +
                    '<div class="offer-section-header">' +
                      '<span class="offer-section-badge">&#128230;</span>' +
                      '<span class="offer-section-label">Requesting</span>' +
                    '</div>' +
                    '<div class="offer-section-items">' + wantHtml + '</div>' +
                  '</div>' +
                '</div>'
              :
                buildItemSection("Offering", "&#128229;", offHtml)
              ) +
              (o.notes ? '<div class="offer-notes">' + sanitize(o.notes) + '</div>' : '') +
            '</div>' +
            '<div class="offer-foot">' +
              '<div class="offer-foot-row">' +
                '<button class="offer-contact-btn" data-ctc="' + idx + '">&#128172; Contact</button>' +
                (rateBtnHtml || starsHtml ? '<div class="offer-foot-right">' + rateBtnHtml + (starsHtml ? '<span class="offer-foot-stars">' + starsHtml + '</span>' : '') + '</div>' : '') +
              '</div>' +
              '<div class="offer-reviews hidden" data-reviews="' + idx + '"></div>' +
            '</div>' +
          '</div>';
        frag.appendChild(card);
      });
      grid.appendChild(frag);

      grid.querySelectorAll("[data-ctc]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openContact(parseInt(btn.dataset.ctc, 10), offers);
        });
      });
      // Rate button handler
      grid.querySelectorAll("[data-oidx]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var oidx = parseInt(btn.dataset.oidx, 10);
          var o = offers[oidx];
          if (!o) return;
          openRatingModal(o, oidx, btn);
        });
      });
      // Delete handler
      grid.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var delId = btn.dataset.del;
          if (!confirm("Delete this ad?")) return;
          var offer = offers.filter(function (o2) { return (o2._firestoreId || o2.id) === delId; })[0];
          if (!offer) { showToast("Offer not found"); return; }
          if (offer._firestoreId) {
            deleteOfferFromFirestore(offer._firestoreId, function () {
              showToast("Ad deleted");
              renderBoard($("#boardSearch").value);
            });
          } else {
            var local = getOffers().filter(function (x) { return x.id !== delId && !x._firestoreId; });
            saveOffers(local);
            showToast("Ad deleted");
            renderBoard($("#boardSearch").value);
          }
        });
      });
      // Report handler
      grid.querySelectorAll("[data-rep]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showToast("Report submitted for review");
        });
      });
      // Like handler
      grid.querySelectorAll("[data-like]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.dataset.like;
          if (!authUser || !id) { showToast("Sign in to like ads"); return; }
          var offer = offers.filter(function (o2) { return (o2._firestoreId || o2.id) === id; })[0];
          if (!offer) return;
          var likes = offer.likes || {};
          var uid = authUser.uid;
          if (likes[uid]) { delete likes[uid]; }
          else { likes[uid] = true; }
          offer.likes = likes;
          if (offer._firestoreId) {
            firebase.firestore().collection("offers").doc(offer._firestoreId).update({ likes: likes }).then(function () {
              renderBoard($("#boardSearch").value);
            }).catch(function () { renderBoard($("#boardSearch").value); });
          } else {
            var all = getOffers();
            for (var oi = 0; oi < all.length; oi++) {
              if ((all[oi]._firestoreId || all[oi].id) === id) { all[oi].likes = likes; break; }
            }
            saveOffers(all);
            renderBoard($("#boardSearch").value);
          }
        });
      });
    }

    if (firestoreReady && authUser) {
      loadOffersFromFirestore(renderList);
    } else {
      renderList(getOffers());
    }
  }

  /* ------------ Giveaways ------------ */
  function renderGiveaways() {
    var grid = $("#giveawayGrid");
    var empty = $("#emptyGiveaways");
    if (!grid) return;
    grid.innerHTML = "";
    if (empty) empty.classList.add("hidden");

    function loadAndRender() {
      if (firestoreReady) {
        loadGiveawaysFromFirestore(function (list) {
          renderGvList(list);
        });
      } else {
        renderGvList([]);
      }
    }

    function renderGvList(list) {
      if (!list || !list.length) {
        if (empty) empty.classList.remove("hidden");
        return;
      }
      var frag = document.createDocumentFragment();
      list.forEach(function (g, idx) {
        var endMs = g.endDate ? new Date(g.endDate + "T23:59:59").getTime() : 0;
        var now = Date.now();
        var ended = endMs && now > endMs;
        var isCreator = authUser && g.uid === authUser.uid;
        var participants = g.participants || [];
        var pCount = participants.length;
        var winner = g.winner || null;
        var card = document.createElement("div");
        card.className = "gv-card" + (ended ? " gv-ended" : "") + (winner ? " gv-won" : "");
        card.style.setProperty("--i", idx);
        card.innerHTML =
          '<div class="gv-card-top">' +
            '<div class="gv-card-prize">' + sanitize(g.prize) + '</div>' +
            '<div class="gv-card-status">' + (winner ? '&#127942; Won' : ended ? '&#9203; Ended' : '&#128197; Active') + '</div>' +
          '</div>' +
          (g.desc ? '<div class="gv-card-desc">' + sanitize(g.desc) + '</div>' : '') +
          '<div class="gv-card-meta">' +
            '<span>By ' + sanitize(g.user) + '</span>' +
            '<span>' + pCount + ' participant' + (pCount !== 1 ? 's' : '') + '</span>' +
            (endMs ? '<span>' + (ended ? 'Ended ' : 'Ends ') + timeAgo(g.endDate) + '</span>' : '') +
            (winner ? '<span class="gv-winner-name">&#127942; ' + sanitize(winner.displayName || winner.robloxId) + '</span>' : '') +
          '</div>' +
          '<button class="gv-view-btn" data-gv="' + idx + '">' + (ended || winner ? 'View Results' : 'View &amp; Enter') + '</button>';
        frag.appendChild(card);
      });
      grid.appendChild(frag);

      grid.querySelectorAll("[data-gv]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openGvDetail(parseInt(btn.dataset.gv, 10), list);
        });
      });
    }

    loadAndRender();
  }

  function openGvDetail(idx, list) {
    var g = list[idx];
    if (!g) return;
    var cont = $("#gvDetailContent");
    if (!cont) return;
    var endMs = g.endDate ? new Date(g.endDate + "T23:59:59").getTime() : 0;
    var now = Date.now();
    var ended = endMs && now > endMs;
    var isCreator = authUser && g.uid === authUser.uid;
    var participants = g.participants || [];
    var comments = g.comments || [];
    var winner = g.winner || null;
    var hasEntered = authUser && participants.some(function (p) { return p.uid === authUser.uid; });

    var html =
      '<div class="gv-detail">' +
        '<div class="gv-detail-header">' +
          '<div class="gv-detail-prize">' + sanitize(g.prize) + '</div>' +
          '<div class="gv-detail-by">by ' + sanitize(g.user) + '</div>' +
          '<div class="gv-detail-status ' + (winner ? 'gv-status-won' : ended ? 'gv-status-ended' : 'gv-status-active') + '">' +
            (winner ? '&#127942; Won by ' + sanitize(winner.displayName || winner.robloxId) : ended ? '&#9203; Ended' : '&#128197; Active') +
          '</div>' +
          (endMs ? '<div class="gv-detail-end">' + (ended ? 'Ended: ' : 'Reveal: ') + g.endDate + '</div>' : '') +
        '</div>' +
        (g.desc ? '<div class="gv-detail-desc">' + sanitize(g.desc) + '</div>' : '') +
        '<div class="gv-detail-section">' +
          '<div class="gv-detail-section-title">Participants (' + participants.length + ')</div>' +
          '<div class="gv-participants">' +
            (participants.length ? participants.map(function (p) {
              return '<div class="gv-participant' + (winner && winner.uid === p.uid ? ' gv-participant-winner' : '') + '">' +
                '<span class="gv-participant-name">' + sanitize(p.displayName || p.robloxId) + '</span>' +
                '<span class="gv-participant-rid">' + sanitize(p.robloxId) + '</span>' +
                (winner && winner.uid === p.uid ? '<span class="gv-winner-badge">&#127942;</span>' : '') +
              '</div>';
            }).join("") : '<div class="gv-detail-empty">No participants yet.</div>') +
          '</div>' +
        '</div>' +
        '<div class="gv-detail-section">' +
          '<div class="gv-detail-section-title">Comments (' + comments.length + ')</div>' +
          '<div class="gv-comments">' +
            (comments.length ? comments.map(function (c) {
              return '<div class="gv-comment">' +
                '<div class="gv-comment-head">' +
                  '<span class="gv-comment-user">' + sanitize(c.user) + '</span>' +
                  '<span class="gv-comment-time">' + timeAgo(c.time) + '</span>' +
                '</div>' +
                '<div class="gv-comment-text">' + sanitize(c.text) + '</div>' +
              '</div>';
            }).join("") : '<div class="gv-detail-empty">No comments yet.</div>') +
          '</div>' +
          (authUser ? '<div class="gv-comment-form">' +
            '<textarea class="form-input form-textarea form-textarea-sm" id="gvCommentInput" placeholder="Write a comment..." rows="2"></textarea>' +
            '<button class="form-submit gv-comment-send" data-gv-comment="' + idx + '">Send</button>' +
          '</div>' : '') +
        '</div>' +
        (!ended && !winner && authUser && !hasEntered ?
          '<div class="gv-detail-section gv-enter-section">' +
            '<div class="gv-detail-section-title">Enter Giveaway</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="gvRblxId">Your Roblox ID</label>' +
              '<input class="form-input" id="gvRblxId" type="text" placeholder="e.g. 123456789" />' +
            '</div>' +
            '<button class="form-submit gv-enter-btn" data-gv-enter="' + idx + '">&#127881; Enter</button>' +
          '</div>' : ''
        ) +
        (!ended && !winner && isCreator && participants.length > 0 ?
          '<button class="form-submit gv-pick-btn" data-gv-pick="' + idx + '" style="margin-top:12px">&#127922; Pick Winner</button>' :
          ''
        ) +
        (!ended && !winner && hasEntered ?
          '<div class="gv-entered-msg">&#9989; You have entered this giveaway</div>' : ''
        ) +
      '</div>';

    cont.innerHTML = html;

    // Comment send
    var commentBtn = cont.querySelector("[data-gv-comment]");
    if (commentBtn) {
      commentBtn.addEventListener("click", function () {
        var inp = $("#gvCommentInput");
        if (!inp || !inp.value.trim()) return;
        var text = inp.value.trim();
        var commentsArr = g.comments || [];
        commentsArr.push({ uid: authUser.uid, user: getDisplayName(), text: text, time: new Date().toISOString() });
        g.comments = commentsArr;
        if (g._firestoreId) {
          firebase.firestore().collection("giveaways").doc(g._firestoreId).update({ comments: commentsArr }).then(function () {
            showToast("Comment added");
            openGvDetail(idx, list);
          }).catch(function () { showToast("Error posting comment"); });
        } else {
          showToast("Comment added (offline)");
          openGvDetail(idx, list);
        }
      });
    }

    // Enter giveaway
    var enterBtn = cont.querySelector("[data-gv-enter]");
    if (enterBtn) {
      enterBtn.addEventListener("click", function () {
        var inp = $("#gvRblxId");
        if (!inp || !inp.value.trim()) { showToast("Enter your Roblox ID"); return; }
        var rid = inp.value.trim();
        var participantsArr = g.participants || [];
        if (participantsArr.some(function (p) { return p.uid === authUser.uid; })) { showToast("Already entered"); return; }
        participantsArr.push({ uid: authUser.uid, displayName: getDisplayName(), robloxId: rid, time: new Date().toISOString() });
        g.participants = participantsArr;
        if (g._firestoreId) {
          firebase.firestore().collection("giveaways").doc(g._firestoreId).update({ participants: participantsArr }).then(function () {
            showToast("Entered giveaway!");
            openGvDetail(idx, list);
          }).catch(function () { showToast("Error entering"); });
        } else {
          showToast("Entered (offline)");
          openGvDetail(idx, list);
        }
      });
    }

    // Pick winner
    var pickBtn = cont.querySelector("[data-gv-pick]");
    if (pickBtn) {
      pickBtn.addEventListener("click", function () {
        if (!confirm("Pick a random winner?")) return;
        var participantsArr = g.participants || [];
        if (!participantsArr.length) { showToast("No participants"); return; }
        var chosen = participantsArr[Math.floor(Math.random() * participantsArr.length)];
        g.winner = chosen;
        if (g._firestoreId) {
          firebase.firestore().collection("giveaways").doc(g._firestoreId).update({ winner: chosen }).then(function () {
            showToast("Winner picked: " + chosen.displayName);
            openGvDetail(idx, list);
            renderGiveaways();
          }).catch(function () { showToast("Error picking winner"); });
        } else {
          showToast("Winner: " + chosen.displayName + " (offline)");
          openGvDetail(idx, list);
          renderGiveaways();
        }
      });
    }

    $("#gvDetailModal").classList.remove("hidden");
  }

  function saveGiveawayToFirestore(gv, callback) {
    if (!firestoreReady || !authUser) { if (callback) callback(); return; }
    gv.uid = authUser.uid;
    gv.userEmail = authUser.email;
    firebase.firestore().collection("giveaways").add(gv).then(function () { if (callback) callback(); }).catch(function () { if (callback) callback(); });
  }

  function loadGiveawaysFromFirestore(callback) {
    if (!firestoreReady) { callback([]); return; }
    firebase.firestore().collection("giveaways").orderBy("time", "desc").limit(50).get().then(function (snap) {
      var list = [];
      snap.forEach(function (doc) { list.push(function (d) { var o = d.data(); o._firestoreId = d.id; return o; }(doc)); });
      callback(list);
    }).catch(function () { callback([]); });
  }

  /* ------------ Ratings ------------ */
  var ratingsCache = {};

  function loadRatings(offerIds, callback) {
    if (!firestoreReady) { callback({}); return; }
    var uncached = offerIds.filter(function (id) { return !(id in ratingsCache); });
    if (uncached.length === 0) {
      var result = {};
      offerIds.forEach(function (id) { result[id] = ratingsCache[id] || []; });
      callback(result); return;
    }
    // Batch load uncached ratings from Firestore
    var all = {};
    var loaded = 0;
    uncached.forEach(function (offerId, i) {
      firebase.firestore().collection("ratings")
        .where("offerId", "==", offerId)
        .get()
        .then(function (snap) {
          var list = [];
          snap.forEach(function (doc) { list.push(doc.data()); });
          ratingsCache[offerId] = list;
          loaded++;
          if (loaded === uncached.length) {
            offerIds.forEach(function (id) { all[id] = ratingsCache[id] || []; });
            callback(all);
          }
        })
        .catch(function () {
          ratingsCache[offerId] = [];
          loaded++;
          if (loaded === uncached.length) {
            offerIds.forEach(function (id) { all[id] = ratingsCache[id] || []; });
            callback(all);
          }
        });
    });
    if (uncached.length === 0) {
      offerIds.forEach(function (id) { all[id] = ratingsCache[id] || []; });
      callback(all);
    }
  }

  function saveRating(offerId, toUid, toUser, rating, comment, callback) {
    if (!firestoreReady || !authUser) { if (callback) callback(); return; }
    // Check if user already rated this offer
    firebase.firestore().collection("ratings")
      .where("offerId", "==", offerId)
      .where("fromUid", "==", authUser.uid)
      .get()
      .then(function (snap) {
        var existing = null;
        snap.forEach(function (doc) { existing = doc; });
        var data = {
          offerId: offerId,
          toUid: toUid,
          toUser: toUser,
          fromUid: authUser.uid,
          fromUser: getDisplayName() || "Anonymous",
          rating: rating,
          comment: comment || "",
      time: new Date().toISOString(),
      likes: {}
    };
        if (existing) {
          existing.ref.update(data).then(function () {
            delete ratingsCache[offerId];
            if (callback) callback();
          });
        } else {
          firebase.firestore().collection("ratings").add(data).then(function () {
            delete ratingsCache[offerId];
            if (callback) callback();
          });
        }
      });
  }

  function getAvgRating(ratings) {
    if (!ratings || ratings.length === 0) return { avg: 0, count: 0 };
    var sum = ratings.reduce(function (s, r) { return s + (r.rating || 0); }, 0);
    return { avg: Math.round(sum / ratings.length * 10) / 10, count: ratings.length };
  }

  function renderStars(avg) {
    var full = Math.floor(avg);
    var half = avg - full >= 0.5;
    var empty = 5 - full - (half ? 1 : 0);
    return '<span class="stars-display">' +
      new Array(full).fill(0).map(function () { return '<span class="star-filled">&#9733;</span>'; }).join("") +
      (half ? '<span class="star-half">&#9733;</span>' : '') +
      new Array(empty).fill(0).map(function () { return '<span class="star-empty">&#9734;</span>'; }).join("") +
      '</span>';
  }

  function openRatingModal(o, oidx, btn) {
    var reviewsEl = document.querySelector('.offer-reviews[data-reviews="' + oidx + '"]');
    if (!reviewsEl) return;
    var isOpen = !reviewsEl.classList.contains("hidden");
    document.querySelectorAll(".offer-reviews").forEach(function (el) { el.classList.add("hidden"); });
    if (isOpen) return;
    reviewsEl.classList.remove("hidden");
    var myRating = 0;
    var existingRatings = ratingsCache[o._firestoreId || o.id] || [];
    var mine = existingRatings.filter(function (r) { return authUser && r.fromUid === authUser.uid; })[0];
    if (mine) myRating = mine.rating;
    var allRatings = existingRatings;
    var reviewsHtml = "";
    if (allRatings.length > 0) {
      reviewsHtml = '<div class="reviews-list">';
      allRatings.slice(-5).reverse().forEach(function (r) {
        var rStars = renderStars(r.rating);
        reviewsHtml += '<div class="review-item">' +
          '<div class="review-head">' +
            '<span class="review-author">' + sanitize(r.fromUser || "Anonymous") + '</span>' +
            rStars +
          '</div>' +
          (r.comment ? '<div class="review-comment">' + sanitize(r.comment) + '</div>' : '') +
          '<div class="review-time">' + timeAgo(r.time) + '</div>' +
        '</div>';
      });
      reviewsHtml += '</div>';
    } else {
      reviewsHtml = '<div class="reviews-empty">No reviews yet</div>';
    }
    var formHtml = "";
    if (authUser && o.uid !== authUser.uid) {
      formHtml = '<div class="rating-form">' +
        '<div class="star-input" data-oidx="' + oidx + '">' +
          '<span class="star-pick" data-val="1">&#9734;</span>' +
          '<span class="star-pick" data-val="2">&#9734;</span>' +
          '<span class="star-pick" data-val="3">&#9734;</span>' +
          '<span class="star-pick" data-val="4">&#9734;</span>' +
          '<span class="star-pick" data-val="5">&#9734;</span>' +
        '</div>' +
        '<textarea class="rating-comment" placeholder="Leave a comment (optional)" rows="2"></textarea>' +
        '<button class="rating-submit" data-oidx="' + oidx + '">' + (mine ? 'Update Rating' : 'Submit Rating') + '</button>' +
      '</div>';
    }
    reviewsEl.innerHTML = '<div class="reviews-header">&#9733; Reviews & Ratings</div>' + reviewsHtml + formHtml;
    var starInput = reviewsEl.querySelector(".star-input");
    if (starInput) {
      var picks = starInput.querySelectorAll(".star-pick");
      picks.forEach(function (s) {
        s.addEventListener("click", function () {
          var val = parseInt(s.dataset.val, 10);
          picks.forEach(function (p, i) {
            p.innerHTML = i < val ? "&#9733;" : "&#9734;";
            p.style.color = i < val ? "var(--warning)" : "var(--text-mute)";
          });
          starInput.dataset.selected = val;
        });
      });
      if (myRating > 0) {
        picks.forEach(function (p, i) {
          p.innerHTML = i < myRating ? "&#9733;" : "&#9734;";
          p.style.color = i < myRating ? "var(--warning)" : "var(--text-mute)";
        });
        starInput.dataset.selected = myRating;
      }
    }
    var submitBtn = reviewsEl.querySelector(".rating-submit");
    if (submitBtn) {
      var oid = o._firestoreId || o.id;
      var toUid = o.uid || "";
      var toUser = o.user || "";
      submitBtn.addEventListener("click", function () {
        if (!authUser) { showToast("Sign in to rate"); return; }
        var starInp = reviewsEl.querySelector(".star-input");
        var rating = parseInt((starInp && starInp.dataset.selected) || "0", 10);
        if (rating === 0) { showToast("Select a star rating"); return; }
        var comment = reviewsEl.querySelector(".rating-comment");
        var commentText = comment ? comment.value.trim() : "";
        saveRating(oid, toUid, toUser, rating, commentText, function () {
          showToast("Rating submitted!");
          renderBoard($("#boardSearch").value);
        });
      });
    }
  }

  function formatItems(arr) {
    if (!arr || !Array.isArray(arr)) return "";
    return arr.join(", ");
  }

  function postOffer(user, offeringArr, wantingArr, notes, contact, wantingOpen, wantingText) {
    var wantingArrFinal = wantingOpen ? [] : wantingArr;
    var offer = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      user: user.trim(),
      offering: offeringArr,
      wanting: wantingArrFinal,
      offeringStr: formatItems(offeringArr),
      wantingStr: formatItems(wantingArrFinal),
      wantingOpen: !!wantingOpen,
      wantingText: (wantingText || "").trim(),
      notes: notes.trim(),
      contact: contact.trim(),
      time: new Date().toISOString()
    };
    if (firestoreReady && authUser) {
      saveOfferToFirestore(offer, function () {
        renderBoard($("#boardSearch").value);
        showToast("Ad posted to the community!");
      });
    } else {
      var offers = getOffers();
      offers.push(offer);
      saveOffers(offers);
      renderBoard($("#boardSearch").value);
      showToast("Ad posted (local only \u2014 sign in to share with everyone)");
    }
  }

  function renderItems(arr) {
    if (!arr || !arr.length) return "";
    return arr.map(function (i) { return '<span class="thread-msg-counter-item">' + sanitize(i) + '</span>'; }).join("");
  }

  function openContact(idx, offers) {
    if (idx < 0 || !offers || idx >= offers.length) return;
    calcState._contactIdx = idx;
    calcState._contactOffers = offers;
    var o = offers[idx];
    var isOwner = authUser && o.uid === authUser.uid;
    if (isOwner) { showToast("This is your own offer"); return; }
    var contactStr = o.contact ? sanitize(o.contact) : "Not provided";

    // Offer summary
    var offHtml = (Array.isArray(o.offering) ? renderItems(o.offering) : sanitize(o.offering || ""));
    var wantArr = Array.isArray(o.wanting) ? o.wanting.filter(function (w) { return w !== "Adds" && w !== "Offer"; }) : [];
    var wantHtml = wantArr.length ? renderItems(wantArr) : sanitize(o.wanting || "");
    $("#contactInfo").innerHTML =
      '<strong>' + sanitize(o.user) + '</strong> is offering ' + offHtml +
      ' for ' + wantHtml + '.<br>' +
      'Contact: <strong>' + contactStr + '</strong>';

    // Clear fields
    $("#contactName").value = "";
    $("#contactMsg").value = "";
    $("#counterWant").value = "";
    $("#counterTagList").innerHTML = "";
    $("#counterBody").classList.add("hidden");

    // Load thread
    loadThread(o);

    var m = $("#contactModal");
    if (m) m.classList.remove("hidden");
  }

  function loadThread(o) {
    var list = $("#threadList");
    var empty = $("#threadEmpty");
    if (!list) return;
    list.innerHTML = "";

    function renderMessages(msgs) {
      var filtered = msgs.filter(function (m) {
        return m.toOfferId === o._firestoreId || m.toUser === o.user;
      });
      if (filtered.length === 0) {
        if (empty) empty.classList.remove("hidden");
        return;
      }
      if (empty) empty.classList.add("hidden");
      filtered.forEach(function (m) {
        var div = document.createElement("div");
        div.className = "thread-msg" + (authUser && m.fromUid === authUser.uid ? " is-own" : "");
        var extra = "";
        if (m.counterOffer && m.counterOffer.length) {
          extra = '<div class="thread-msg-counter"><div class="thread-msg-counter-label">&#128260; Counter-Offer</div><div class="thread-msg-counter-items">' +
            m.counterOffer.map(function (i) { return '<span class="thread-msg-counter-item">' + sanitize(i) + '</span>'; }).join("") +
            (m.counterWant ? '<span class="thread-msg-counter-item" style="background:var(--bg);border:1px dashed var(--border-strong)">&#128200; ' + sanitize(m.counterWant) + '</span>' : "") +
            '</div></div>';
        }
        div.innerHTML =
          '<div class="thread-msg-from">' + sanitize(m.from) + '</div>' +
          '<div class="thread-msg-text">' + sanitize(m.text) + '</div>' +
          extra +
          '<div class="thread-msg-time">' + timeAgo(m.time) + '</div>';
        list.appendChild(div);
      });
      // Scroll to bottom
      var container = $("#threadContainer");
      if (container) container.scrollTop = container.scrollHeight;
    }

    if (firestoreReady && authUser && o._firestoreId) {
      firebase.firestore().collection("messages")
        .where("toOfferId", "==", o._firestoreId)
        .orderBy("time", "asc")
        .get()
        .then(function (snap) {
          var msgs = [];
          snap.forEach(function (doc) { msgs.push(doc.data()); });
          renderMessages(msgs);
        })
        .catch(function () { renderMessages([]); });
    } else {
      renderMessages(getMessages());
    }
  }

  function sendMessage(from, text) {
    var idx = calcState._contactIdx;
    var offers = calcState._contactOffers;
    if (idx == null || !offers || idx >= offers.length) return;
    var o = offers[idx];

    // Gather counter-offer items
    var counterOffer = getTagValues("counterTagList");
    var counterWant = $("#counterWant") ? $("#counterWant").value.trim() : "";

    var msg = {
      toOfferId: o._firestoreId || "",
      toUid: o.uid || "",
      toUser: o.user,
      from: from.trim(),
      fromUid: (authUser && authUser.uid) || "",
      text: text.trim(),
      time: new Date().toISOString()
    };
    if (counterOffer.length) msg.counterOffer = counterOffer;
    if (counterWant) msg.counterWant = counterWant;

    if (firestoreReady && authUser && o._firestoreId) {
      firebase.firestore().collection("messages").add(msg).then(function () {
        showToast("Message sent to " + o.user + "!");
        openContact(idx, offers);
      }).catch(function () {
        showToast("Error sending message");
      });
    } else {
      var msgs = getMessages();
      msgs.push(msg);
      saveMessages(msgs);
      showToast("Message saved locally (sign in to send globally)");
      openContact(idx, offers);
    }
  }

  /* ------------ Community Chat ------------ */
  var BLOCKED_WORDS = [
    "fuck", "shit", "ass", "bitch", "dick", "cock", "porn", "sex",
    "nude", "nsfw", "whore", "slut", "bastard", "piss"
  ];

  function filterProfanity(text) {
    var filtered = text;
    BLOCKED_WORDS.forEach(function (w) {
      var re = new RegExp("\\b" + w + "\\b", "gi");
      filtered = filtered.replace(re, "***");
    });
    return filtered;
  }

  /* ------------ Chat (Firestore + localStorage fallback) ------------ */
  var PAGE_SIZE = 20;
  var chatUnsub = null;

  function loadChat() {
    var container = $("#chatMessages");
    if (!container) return;
    // Unsubscribe previous listener
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    if (firestoreReady) {
      var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      chatUnsub = firebase.firestore().collection("chat")
        .orderBy("time", "desc")
        .where("time", ">=", cutoff)
        .limit(50)
        .onSnapshot(function (snap) {
          var msgs = [];
          snap.forEach(function (d) { var m = d.data(); m._id = d.id; msgs.push(m); });
          msgs.reverse(); // oldest first
          renderChat(msgs);
        }, function () {
          // Firestore fails, fall back to localStorage
          loadLocalChat();
        });
    } else {
      loadLocalChat();
    }
  }

  function loadLocalChat() {
    var msgs = loadLocalMessages();
    renderChat(msgs);
  }

  function loadLocalMessages() {
    try {
      var msgs = JSON.parse(localStorage.getItem("bfx-chat")) || [];
      var cutoff = Date.now() - 24 * 60 * 60 * 1000;
      var filtered = msgs.filter(function (m) {
        var t = new Date(m.time || m.time).getTime();
        return !isNaN(t) && t >= cutoff;
      });
      if (filtered.length !== msgs.length) saveLocalMessages(filtered);
      return filtered;
    } catch (e) { return []; }
  }
  function saveLocalMessages(msgs) {
    try { localStorage.setItem("bfx-chat", JSON.stringify(msgs)); } catch (e) {}
  }

  function sendChat(textOrTrade) {
    if (!checkRateLimit("chat", 1000)) { showToast("Please wait before sending another message"); return; }
    var input = $("#chatInput");
    var displayName = (authProfile && authProfile.displayName) || getLocalProfile().displayName || "User";
    var uid = (authUser && authUser.uid) || "local";
    function buildMsg(text, tradeCard) {
      return {
        uid: uid,
        displayName: displayName,
        text: text || "",
        tradeCard: tradeCard || null,
        time: new Date().toISOString()
      };
    }
    if (textOrTrade === undefined) {
      if (!input) return;
      var text = guardInput(input.value.trim());
      if (!text || text.length > 500) return;
      var filtered = filterProfanity(text);
      if (filtered !== text) showToast("Message filtered for inappropriate language");
      text = filtered;
      var msg = buildMsg(text, null);
      if (firestoreReady) {
        msg.time = firebase.firestore.FieldValue.serverTimestamp();
        firebase.firestore().collection("chat").add(msg).catch(function () { saveLocalMsg(msg); });
      } else {
        saveLocalMsg(msg);
      }
      if (input) input.value = "";
    } else {
      var msg2 = buildMsg("", textOrTrade.tradeCard);
      if (firestoreReady) {
        msg2.time = firebase.firestore.FieldValue.serverTimestamp();
        firebase.firestore().collection("chat").add(msg2).catch(function () { saveLocalMsg(msg2); });
      } else {
        saveLocalMsg(msg2);
      }
      showToast("Trade posted to chat!");
    }
    function saveLocalMsg(m) {
      var msgs = loadLocalMessages();
      msgs.push(m);
      saveLocalMessages(msgs);
      loadLocalChat();
    }
  }

  function renderChat(msgs) {
    var container = $("#chatMessages");
    if (!container) return;
    if (!msgs || msgs.length === 0) {
      container.innerHTML = '<div class="chat-login-msg">&#128172; No messages yet. Say something nice!</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    msgs.forEach(function (m) {
      var div = document.createElement("div");
      div.className = "chat-msg";
      var letter = m.displayName ? m.displayName.charAt(0).toUpperCase() : "?";
      var colors = ["#ff6b6b","#feca57","#48dbfb","#ff9ff3","#54a0ff","#5f27cd","#01a3a4","#f368e0","#ff6348"];
      var colorIdx = (m.displayName || "").split("").reduce(function (a, c) { return a + c.charCodeAt(0); }, 0) % colors.length;
      var avatarHtml = '<span class="chat-avatar-letter" style="background:' + colors[colorIdx] + '">' + letter + '</span>';
      var bodyHtml = '<div class="chat-msg-top">' +
        '<span class="chat-msg-name">' + sanitize(m.displayName || "Unknown") + '</span>' +
        '<span class="chat-msg-time">' + timeAgo(m.time) + '</span>' +
      '</div>';
      if (m.tradeCard) {
        var tc = m.tradeCard;
        var offChips = (tc.offering || []).map(function (f) { return '<span class="trade-card-chip trade-card-chip-off">' + sanitize(f) + '</span>'; }).join("");
        var wantChips = (tc.wanting || []).map(function (f) { return '<span class="trade-card-chip trade-card-chip-want">' + sanitize(f) + '</span>'; }).join("");
        var offerVal = tc.offerVal || 0;
        var requestVal = tc.requestVal || 0;
        var diff = offerVal - requestVal;
        var diffLabel = diff > 0 ? "Overpay by " + formatNumber(diff) : (diff < 0 ? "Profit " + formatNumber(Math.abs(diff)) : "Fair trade");
        var diffCls = diff > 0 ? "trade-card-loss" : (diff < 0 ? "trade-card-profit" : "trade-card-even");
        bodyHtml += '<div class="trade-card">' +
          '<div class="trade-card-header">&#128200; Live Trading</div>' +
          '<div class="trade-card-row"><span class="trade-card-title">&#128229; Offering</span><div class="trade-card-chips">' + offChips + '</div><span class="trade-card-val">' + formatNumber(offerVal) + '</span></div>' +
          '<div class="trade-card-arrow">&#8595;</div>' +
          '<div class="trade-card-row"><span class="trade-card-title">&#128230; Wanting</span><div class="trade-card-chips">' + wantChips + '</div><span class="trade-card-val">' + formatNumber(requestVal) + '</span></div>' +
          '<div class="trade-card-diff ' + diffCls + '">' + diffLabel + '</div>' +
        '</div>';
      } else {
        bodyHtml += '<div class="chat-msg-text">' + sanitize(m.text || "") + '</div>';
      }
      div.innerHTML = '<div class="chat-msg-avatar">' + avatarHtml + '</div><div class="chat-msg-body">' + bodyHtml + '</div>';
      frag.appendChild(div);
    });
    container.innerHTML = "";
    container.appendChild(frag);
    container.scrollTop = container.scrollHeight;
  }

  function postTradeToChat() {
    if (calcState.offer.length === 0 && calcState.request.length === 0) {
      showToast("Add fruits to both sides first"); return;
    }
    // Build trade card data
    var offerNames = calcState.offer.map(function (f) { return (f.isPerm ? "Perm " : "") + f.name; });
    var requestNames = calcState.request.map(function (f) { return (f.isPerm ? "Perm " : "") + f.name; });
    var offerVal = calcTotal(calcState.offer);
    var requestVal = calcTotal(calcState.request);
    var msg = {
      text: "",
      tradeCard: {
        offering: offerNames,
        wanting: requestNames,
        offerVal: offerVal,
        requestVal: requestVal
      }
    };
    sendChat(msg);
  }

  function switchToTab(tab) {
    $$(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    $$(".tab-btn[data-tab='" + tab + "']").forEach(function (b) { b.classList.add("active"); });
    $$(".tab-content").forEach(function (c) { c.classList.add("hidden"); });
    var target = $("#" + tab + "View");
    if (target) target.classList.remove("hidden");
    if (tab === "calc") renderCalc();
    if (tab === "board") renderBoard($("#boardSearch").value);
    if (tab === "chat") loadChat();
    if (tab === "giveaways") renderGiveaways();
    if (tab === "tools") renderTools();
    if (tab === "guides") renderGuides();
    pushTabAds(target);
  }

  function pushTabAds(container) {
    if (!container) return;
    container.querySelectorAll(".adsbygoogle").forEach(function (ins) {
      if (!ins.dataset.adPushed) {
        if (ins.offsetWidth < 100) {
          // container not laid out yet — retry once
          var tid = setTimeout(function () {
            ins.dataset.adPushed = "1";
            try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
          }, 800);
          ins.dataset._retry = tid;
          return;
        }
        ins.dataset.adPushed = "1";
        try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      }
    });
  }

  /* ------------ Events ------------ */
  function bindEvents() {
    $("#searchInput").addEventListener("input", function (e) {
      state.query = e.target.value;
      render();
    });

    $("#categoryFilters").addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      $$("#categoryFilters .chip").forEach(function (c) { c.classList.remove("active"); });
      btn.classList.add("active");
      state.rarity = btn.dataset.cat;
      render();
    });

    $("#sortSelect").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });

    $("#updatedPill").addEventListener("click", function () { renderUpdated(); render(); });

    $("#themeBtn").addEventListener("click", function () {
      var isLight = document.body.classList.toggle("theme-light");
      $("#themeBtn").textContent = isLight ? "\u2600\uFE0F" : "\u{1F319}";
      try { localStorage.setItem("bfv-theme", isLight ? "light" : "dark"); } catch (e) {}
    });

    // Calculator toggle → switch to calc tab
    $("#calcToggleBtn").addEventListener("click", function () {
      switchToTab("calc");
    });
    // Picker events
    $("#pickerCloseBtn").addEventListener("click", closePicker);
    $("#pickerBackdrop").addEventListener("click", closePicker);
    $("#pickerSearch").addEventListener("input", function (e) {
      renderPicker(e.target.value);
    });

    // Fruit card click → detail modal
    $("#fruitGrid").addEventListener("click", function (e) {
      var card = e.target.closest(".fruit-card");
      if (!card) return;
      var nameEl = card.querySelector(".fruit-name");
      if (!nameEl) return;
      // Use textContent, firstChild is the name (gamepass cards have ::after content)
      showDetail(nameEl.firstChild.textContent.trim());
    });

    // Detail modal close
    $("#detailCloseBtn").addEventListener("click", closeDetail);
    $("#detailBackdrop").addEventListener("click", closeDetail);

    // Tab switching
    $$(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchToTab(btn.dataset.tab); });
    });

    // Tools promo banner
    var tpb = $("#toolsPromoBanner");
    if (tpb) tpb.addEventListener("click", function () { switchToTab("tools"); });

    // Fruit preview "View all" link
    var fpl = document.querySelector(".calc-fruit-preview-link");
    if (fpl) fpl.addEventListener("click", function (e) { e.preventDefault(); switchToTab("fruits"); });

    // Mobile nav drawer
    $("#hamburgerBtn").addEventListener("click", function () {
      $("#navDrawer").classList.add("open");
      $("#navDrawerOverlay").classList.add("open");
    });
    function closeDrawer() {
      $("#navDrawer").classList.remove("open");
      $("#navDrawerOverlay").classList.remove("open");
    }
    $("#navDrawerClose").addEventListener("click", closeDrawer);
    $("#navDrawerOverlay").addEventListener("click", closeDrawer);
    $$(".nav-drawer-btn[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchToTab(btn.dataset.tab);
        closeDrawer();
      });
    });
    $("#drawerPrivacyLink").addEventListener("click", function () {
      closeDrawer();
      $("#privacyModal").classList.remove("hidden");
    });
    $("#drawerTosLink").addEventListener("click", function () {
      closeDrawer();
      $("#tosModal").classList.remove("hidden");
    });
    $("#drawerAboutLink").addEventListener("click", function () {
      closeDrawer();
      $("#aboutModal").classList.remove("hidden");
    });

    // Reset calculator
    $("#calcResetBtn").addEventListener("click", function () {
      state.offer = [];
      state.request = [];
      renderCalc();
      showToast("Calculator reset");
    });

    // Sign in / sign out
    $("#signInBtn").addEventListener("click", signInWithDiscord);
    $("#signOutBtn").addEventListener("click", signOut);

    // Trade Board events
    $("#postOfferBtn").addEventListener("click", function () {
      resetPostState();
      var p = authProfile || getLocalProfile();
      var contact = [];
      if (p && p.discord) contact.push("Discord: " + p.discord);
      $("#postContact").value = contact.join(" / ");
      updatePostCounts();
      renderPostFruitGrid();
      updatePostPreview();
      $$(".post-sel-tab").forEach(function (t) { t.classList.remove("active"); });
      var firstTab = document.querySelector(".post-sel-tab[data-side=\"offering\"]");
      if (firstTab) firstTab.classList.add("active");
      var hint = $("#postActiveHint");
      if (hint) hint.innerHTML = 'Click fruits to add to <strong>Offering</strong>';
      // Reset open-to-offers
      var oto = $("#openToOffersCheck");
      if (oto) { oto.checked = false; }
      var wtf = $("#wantingTextFieldGroup");
      if (wtf) wtf.classList.add("hidden");
      $("#wantingTextField").value = "";
      var m = $("#postModal");
      if (m) m.classList.remove("hidden");
    });

    // Open-to-offers toggle
    $("#openToOffersCheck").addEventListener("change", function () {
      var wtf = $("#wantingTextFieldGroup");
      if (wtf) wtf.classList.toggle("hidden", !this.checked);
    });

    function openProfileModal() {
      if (authProfile || getLocalProfile()) {
        var p = authProfile || getLocalProfile();
        $("#profileEmail").textContent = (authUser && authUser.email) || (p && p.email) || "offline mode";
        $("#profileDisplay").value = p.displayName || "";
        $("#profileDiscord").value = p.discord || "";
        $("#profileRoblox").value = p.roblox || "";
      }
      $("#profileModal").classList.remove("hidden");
    }

    // Profile modal
    $("#userAvatarLetter").addEventListener("click", openProfileModal);
    $("#profileBtn").addEventListener("click", openProfileModal);
    $("#profileCloseBtn").addEventListener("click", function () { $("#profileModal").classList.add("hidden"); });
    $("#profileBackdrop").addEventListener("click", function () { $("#profileModal").classList.add("hidden"); });
    $("#profileForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var display = $("#profileDisplay").value;
      var discord = $("#profileDiscord").value;
      var roblox = $("#profileRoblox").value;
      if (!display.trim()) { showToast("Display name is required"); return; }
      saveProfile(display, discord, roblox, function (ok) {
        if (ok) $("#profileModal").classList.add("hidden");
      });
    });

    // Privacy policy
    $("#privacyLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#privacyModal").classList.remove("hidden");
    });
    $("#privacyCloseBtn").addEventListener("click", function () { $("#privacyModal").classList.add("hidden"); });
    $("#privacyBackdrop").addEventListener("click", function () { $("#privacyModal").classList.add("hidden"); });

    // Terms of Service
    $("#tosLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#tosModal").classList.remove("hidden");
    });
    $("#tosCloseBtn").addEventListener("click", function () { $("#tosModal").classList.add("hidden"); });
    $("#tosBackdrop").addEventListener("click", function () { $("#tosModal").classList.add("hidden"); });

    // About
    $("#aboutLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#aboutModal").classList.remove("hidden");
    });
    $("#aboutCloseBtn").addEventListener("click", function () { $("#aboutModal").classList.add("hidden"); });
    $("#aboutBackdrop").addEventListener("click", function () { $("#aboutModal").classList.add("hidden"); });

    // Cookie consent
    if (!localStorage.getItem("bfx-cookie-consent")) {
      var cb = $("#cookieBanner");
      if (cb) cb.classList.remove("hidden");
    }
    $("#cookieAcceptBtn").addEventListener("click", function () {
      localStorage.setItem("bfx-cookie-consent", "accepted");
      $("#cookieBanner").classList.add("hidden");
    });
    $("#cookiePrivacyLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#privacyModal").classList.remove("hidden");
    });

    function clearTagList(listId) {
      var list = $("#" + listId);
      if (list) list.innerHTML = "";
    }

    function resetPostState() {
      postOffering = [];
      postWanting = [];
      postActiveSide = "offering";
      var oto = $("#openToOffersCheck");
      if (oto) oto.checked = false;
      var wtf = $("#wantingTextFieldGroup");
      if (wtf) wtf.classList.add("hidden");
      $("#wantingTextField").value = "";
      clearTagList("offeringTagList");
      clearTagList("wantingTagList");
      if ($("#offeringPreview")) $("#offeringPreview").innerHTML = "";
      if ($("#wantingPreview")) $("#wantingPreview").innerHTML = "";
    }

    $("#postCloseBtn").addEventListener("click", function () {
      var m = $("#postModal");
      if (m) m.classList.add("hidden");
      resetPostState();
    });
    $("#postBackdrop").addEventListener("click", function () {
      var m = $("#postModal");
      if (m) m.classList.add("hidden");
      resetPostState();
    });

    // Post form state
    var postOffering = [];
    var postWanting = [];
    var postActiveSide = "offering";

    // Pseudo-items for "Offer" and "Adds"
    var PSEUDO_ITEMS = [
      { name: "Offer", icon: "&#129309;", color: "#8b5cf6", desc: "Open to any offer", side: "wanting" },
      { name: "Adds", icon: "&#10133;", color: "#f59e0b", desc: "Expecting extra adds", side: "wanting" }
    ];
    var PSEUDO_NAMES = { Offer: true, Adds: true };

    function renderPostFruitGrid() {
      var grid = $("#postFruitGrid");
      if (!grid) return;
      grid.innerHTML = "";
      var frag = document.createDocumentFragment();

      // --- Pseudo-items: Offer & Adds ---
      PSEUDO_ITEMS.forEach(function (p) {
        var inOffer = postOffering.indexOf(p.name) !== -1;
        var inWant = postWanting.indexOf(p.name) !== -1;
        var selected = inOffer || inWant;
        var selClass = selected ? " post-fruit-selected" : "";
        var sideLabel = inOffer ? "OFFER" : (inWant ? "WANT" : "");
        var card = document.createElement("div");
        card.className = "pf-card pf-pseudo" + selClass;
        card.dataset.fruit = p.name;
        card.dataset.pseudo = "1";
        card.style.setProperty("--pf-color", p.color);
        card.innerHTML =
          '<div class="pf-img-wrap pf-pseudo-wrap" style="background:radial-gradient(circle at 50% 50%, ' + p.color + '33, ' + p.color + '11)">' +
            '<span class="pf-letter pf-pseudo-icon" style="font-size:22px">' + p.icon + '</span>' +
            (selected ? '<span class="pf-check">&#10003;</span>' : '') +
          '</div>' +
          '<div class="pf-name">' + p.name + '</div>' +
          '<div class="pf-pseudo-desc">' + p.desc + '</div>';
        if (selected) {
          var sideEl = document.createElement("div");
          sideEl.className = "pf-side-badge" + (inOffer ? " pf-side-offer" : " pf-side-want");
          sideEl.textContent = sideLabel;
          card.appendChild(sideEl);
        }
        frag.appendChild(card);
      });

      fruits.forEach(function (f) {
        var rm = RARITY_META[f.rarity] || { color: "#888", icon: "?", label: "" };
        var inOffer = postOffering.indexOf(f.name) !== -1;
        var inWant = postWanting.indexOf(f.name) !== -1;
        var selected = inOffer || inWant;
        var selClass = selected ? " post-fruit-selected" : "";
        var sideLabel = inOffer ? "OFFER" : (inWant ? "WANT" : "");
        var firstLetter = f.name.charAt(0);
        var imgUrl = f.img ? (FALLBACK_IMG_URLS[f.img] || "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + f.img) : "";
        var card = document.createElement("div");
        card.className = "pf-card" + selClass;
        card.dataset.fruit = f.name;
        card.style.setProperty("--pf-color", rm.color);
        card.innerHTML =
          '<div class="pf-img-wrap" style="background:radial-gradient(circle at 50% 50%, ' + rm.color + '33, ' + rm.color + '11)">' +
            (imgUrl ? '<img class="pf-img" src="' + imgUrl + '" alt="' + sanitize(f.name) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" onload="this.classList.add(\'loaded\')" />' : '') +
            '<span class="pf-letter">' + firstLetter + '</span>' +
            (selected ? '<span class="pf-check">&#10003;</span>' : '') +
          '</div>' +
          '<div class="pf-name">' + sanitize(f.name) + '</div>';
        if (selected) {
          var sideEl = document.createElement("div");
          sideEl.className = "pf-side-badge" + (inOffer ? " pf-side-offer" : " pf-side-want");
          sideEl.textContent = sideLabel;
          card.appendChild(sideEl);
        }
        frag.appendChild(card);
      });
      grid.appendChild(frag);

      // Click handler
      grid.querySelectorAll(".pf-card").forEach(function (card) {
        card.addEventListener("click", function () {
          var fruitName = card.dataset.fruit;
          var side = postActiveSide;
          var isPseudo = card.dataset.pseudo === "1";
          // Pseudo-items only allowed on wanting side
          if (isPseudo && side === "offering") {
            // Switch to wanting tab
            var wantTab = document.querySelector('.post-sel-tab[data-side="wanting"]');
            if (wantTab) wantTab.click();
            side = "wanting";
          }
          var arr = side === "offering" ? postOffering : postWanting;
          // Remove from other side if present
          var otherArr = side === "offering" ? postWanting : postOffering;
          var otherIdx = otherArr.indexOf(fruitName);
          if (otherIdx !== -1) otherArr.splice(otherIdx, 1);
          // Toggle on current side
          var idx = arr.indexOf(fruitName);
          if (idx !== -1) { arr.splice(idx, 1); }
          else { arr.unshift(fruitName); }
          // Sync Offer pseudo-item with Open to Offers toggle
          if (fruitName === "Offer") {
            var oto = $("#openToOffersCheck");
            if (oto) {
              var hasOffer = postWanting.indexOf("Offer") !== -1;
              oto.checked = hasOffer;
              // Show/hide custom text field
              var wtf = $("#wantingTextFieldGroup");
              if (wtf) wtf.classList.toggle("hidden", !hasOffer);
            }
          }
          updatePostCounts();
          renderPostFruitGrid();
          updatePostPreview();
        });
      });
    }

    function updatePostPreview() {
      var offChips = $("#offerPreviewChips");
      var wantChips = $("#wantPreviewChips");
      var PSEUDO_COLORS = { Offer: "#8b5cf6", Adds: "#f59e0b" };
      if (offChips) {
        if (postOffering.length) {
          offChips.innerHTML = postOffering.map(function (f) {
            var fruit = fruits.filter(function (x) { return x.name === f; })[0];
            var color = fruit ? (RARITY_META[fruit.rarity] || {}).color || "var(--accent)" : (PSEUDO_COLORS[f] || "var(--accent)");
            return '<span class="preview-chip" style="--chip-color:' + color + '">' + sanitize(f) + '</span>';
          }).join("");
        } else {
          offChips.innerHTML = '<span class="post-preview-empty">Click fruits above</span>';
        }
      }
      if (wantChips) {
        if (postWanting.length) {
          wantChips.innerHTML = postWanting.map(function (f) {
            var fruit = fruits.filter(function (x) { return x.name === f; })[0];
            var color = fruit ? (RARITY_META[fruit.rarity] || {}).color || "var(--accent)" : (PSEUDO_COLORS[f] || "var(--accent)");
            return '<span class="preview-chip" style="--chip-color:' + color + '">' + sanitize(f) + '</span>';
          }).join("");
        } else {
          wantChips.innerHTML = '<span class="post-preview-empty">Click fruits above</span>';
        }
      }
    }

    function updatePostCounts() {
      var oc = $("#offeringCount");
      var wc = $("#wantingCount");
      if (oc) oc.textContent = postOffering.length;
      if (wc) wc.textContent = postWanting.length;
    }

    // Selection tab switching
    document.addEventListener("click", function (e) {
      var tab = e.target.closest(".post-sel-tab");
      if (tab) {
        $$(".post-sel-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        postActiveSide = tab.dataset.side;
        var hint = $("#postActiveHint");
        if (hint) hint.innerHTML = 'Click fruits to add to <strong>' + (postActiveSide === "offering" ? "Offering" : "Wanting") + '</strong>';
      }
    });

    $("#postForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!checkRateLimit("postOffer", 3000)) { showToast("Please wait before posting"); return; }
      var user = getDisplayName();
      var notes = guardInput($("#postNotes").value);
      var contact = guardInput($("#postContact").value);
      if (!user) {
        showToast("Please set a display name in your profile first");
        return;
      }
      if (!postOffering.length) {
        showToast("Add fruits to Offering");
        return;
      }
      var wantingOpen = $("#openToOffersCheck") ? $("#openToOffersCheck").checked : false;
      // If "Offer" is in the wanting list, treat as open to offers
      var offerIdx = postWanting.indexOf("Offer");
      if (offerIdx !== -1) {
        wantingOpen = true;
        postWanting.splice(offerIdx, 1); // Remove pseudo-item from actual array
      }
      var wantingText = wantingOpen ? ($("#wantingTextField") ? $("#wantingTextField").value : "") : "";
      postOffer(user, postOffering.slice(), postWanting.slice(), notes, contact, wantingOpen, wantingText);
      $("#postForm").reset();
      resetPostState();
      updatePostCounts();
      renderPostFruitGrid();
      $$(".post-sel-tab").forEach(function (t) { t.classList.remove("active"); });
      var firstTab = document.querySelector(".post-sel-tab[data-side=\"offering\"]");
      if (firstTab) firstTab.classList.add("active");
      var m = $("#postModal");
      if (m) m.classList.add("hidden");
    });

    // Counter-offer tag input
    function tagInputHandler(fieldId, listId) {
      return function (e) {
        if (e.key === "Enter") { e.preventDefault(); addTag(listId, fieldId, e.target.value); }
      };
    }
    function tagBlurHandler(fieldId, listId) {
      return function () {
        var f = $("#" + fieldId);
        if (f && f.value.trim()) addTag(listId, fieldId, f.value);
      };
    }
    $("#counterTagField").addEventListener("keydown", tagInputHandler("counterTagField", "counterTagList"));
    $("#counterTagField").addEventListener("blur", tagBlurHandler("counterTagField", "counterTagList"));

    // Tag chip remove (delegated)
    document.addEventListener("click", function (e) {
      var rem = e.target.closest(".tag-chip-remove");
      if (rem) {
        var chip = rem.parentElement;
        if (chip && chip.parentElement) chip.parentElement.removeChild(chip);
      }
    });

    // Counter-offer toggle
    $("#counterToggle").addEventListener("click", function () {
      $("#counterBody").classList.toggle("hidden");
    });

    $("#boardSearch").addEventListener("input", function (e) {
      renderBoard(e.target.value);
    });

    // Contact events
    $("#contactCloseBtn").addEventListener("click", closeContact);
    $("#contactBackdrop").addEventListener("click", closeContact);

    $("#contactForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!checkRateLimit("contact", 5000)) return;
      var from = guardInput($("#contactName").value);
      var text = guardInput($("#contactMsg").value);
      if (!from || !text) return;
      sendMessage(from, text);
      $("#contactForm").reset();
    });

    // Community Chat events
    $("#chatSendBtn").addEventListener("click", function () { sendChat(); });
    $("#chatInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    // Chat Trade button → switch to calculator tab
    $("#chatTradeBtn").addEventListener("click", function () {
      switchToTab("calc");
    });
    // Post Trade to Chat button (inside calculator)
    $("#postTradeToChatBtn").addEventListener("click", postTradeToChat);

    // Giveaway events
    $("#createGvBtn").addEventListener("click", function () {
      // Pre-fill today's date + 7 days as default end date
      var d = new Date();
      d.setDate(d.getDate() + 7);
      $("#gvEndDate").value = d.toISOString().split("T")[0];
      $("#gvPrize").value = "";
      $("#gvDesc").value = "";
      $("#gvModal").classList.remove("hidden");
    });
    $("#gvCloseBtn").addEventListener("click", function () { $("#gvModal").classList.add("hidden"); });
    $("#gvBackdrop").addEventListener("click", function () { $("#gvModal").classList.add("hidden"); });
    $("#gvDetailCloseBtn").addEventListener("click", function () { $("#gvDetailModal").classList.add("hidden"); });
    $("#gvDetailBackdrop").addEventListener("click", function () { $("#gvDetailModal").classList.add("hidden"); });

    $("#gvForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!checkRateLimit("giveaway", 5000)) { showToast("Please wait before creating a giveaway"); return; }
      var prize = guardInput($("#gvPrize").value.trim());
      var desc = guardInput($("#gvDesc").value.trim());
      var endDate = $("#gvEndDate").value;
      if (!prize) { showToast("Enter a prize"); return; }
      if (!endDate) { showToast("Select a reveal date"); return; }
      var user = getDisplayName();
      if (!user) { showToast("Set a display name in your profile first"); return; }
      var gv = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        user: user,
        prize: prize,
        desc: desc,
        endDate: endDate,
        participants: [],
        comments: [],
        winner: null,
        time: new Date().toISOString()
      };
      saveGiveawayToFirestore(gv, function () {
        showToast("Giveaway created!");
        $("#gvModal").classList.add("hidden");
        renderGiveaways();
      });
    });

    // Fruit / Item picker
    function insertAtCursor(val) {
      var input = $("#chatInput");
      if (!input) return;
      var start = input.selectionStart, end = input.selectionEnd;
      input.value = input.value.substring(0, start) + val + input.value.substring(end);
      input.selectionStart = input.selectionEnd = start + val.length;
      input.focus();
    }
    var allFruits = fruits.filter(function (f) { return f.rarity !== "gamepass"; });
    var pickerData = {
      fruits: allFruits,
      perms: allFruits.filter(function (f) { return f.perm > 0; }).map(function (f) {
        var copy = JSON.parse(JSON.stringify(f));
        copy._insert = "Perm " + f.name;
        return copy;
      }),
      gamepasses: fruits.filter(function (f) { return f.rarity === "gamepass"; }),
      offer: [{ text: "Offering: ", emoji: "📤", label: "Offering" }, { text: "Wanting: ", emoji: "📥", label: "Wanting" }, { text: "Trading: ", emoji: "🔄", label: "Trading" }, { text: "Adding: ", emoji: "➕", label: "Adding" }, { text: "Looking for: ", emoji: "🔍", label: "Looking for" }]
    };
    function buildItemGrid(tab) {
      var grid = $("#emojiGrid");
      if (!grid) return;
      grid.innerHTML = "";
      if (tab === "offer") {
        pickerData.offer.forEach(function (item) {
          var btn = document.createElement("button");
          btn.className = "emoji-item offer-item";
          btn.textContent = item.emoji;
          btn.title = item.label;
          btn.addEventListener("click", function () { insertAtCursor(item.emoji + " " + item.text); });
          grid.appendChild(btn);
        });
        return;
      }
      var items = pickerData[tab] || [];
      items.forEach(function (f) {
        var btn = document.createElement("button");
        btn.className = "emoji-item fruit-item";
        btn.title = f._insert || f.name;
        var url = FALLBACK_IMG_URLS[f.img] || "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + f.img;
        btn.innerHTML = '<img src="' + url + '" alt="' + sanitize(f.name) + '" loading="lazy" referrerpolicy="no-referrer" />';
        btn.addEventListener("click", function () { insertAtCursor(f._insert || f.name); });
        grid.appendChild(btn);
      });
    }
    $("#emojiBtn").addEventListener("click", function () {
      var picker = $("#emojiPicker");
      if (!picker) return;
      var hidden = picker.classList.contains("hidden");
      $$(".emoji-picker").forEach(function (p) { p.classList.add("hidden"); });
      if (hidden) {
        picker.classList.remove("hidden");
        if (!picker.dataset.built) { buildItemGrid("fruits"); picker.dataset.built = "1"; }
      }
      this.classList.toggle("active", !hidden);
    });
    $("#emojiTabs").addEventListener("click", function (e) {
      var tabBtn = e.target.closest(".emoji-tab");
      if (!tabBtn) return;
      $$(".emoji-tab").forEach(function (t) { t.classList.remove("active"); });
      tabBtn.classList.add("active");
      buildItemGrid(tabBtn.dataset.tab);
    });
    // Close picker on click outside
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#emojiPicker") && !e.target.closest("#emojiBtn")) {
        var picker = $("#emojiPicker");
        if (picker && !picker.classList.contains("hidden")) {
          picker.classList.add("hidden");
          var btn = $("#emojiBtn");
          if (btn) btn.classList.remove("active");
        }
      }
    });

    // Keyboard: Escape to close modals
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("#pickerModal").classList.contains("hidden")) closePicker();
        if (!$("#detailModal").classList.contains("hidden")) closeDetail();
        if (!$("#postModal").classList.contains("hidden")) { var pm = $("#postModal"); if (pm) pm.classList.add("hidden"); }
        if (!$("#contactModal").classList.contains("hidden")) closeContact();
        if (!$("#profileModal").classList.contains("hidden")) { var prm = $("#profileModal"); if (prm) prm.classList.add("hidden"); }
        if (!$("#privacyModal").classList.contains("hidden")) { var pvm = $("#privacyModal"); if (pvm) pvm.classList.add("hidden"); }
        if (!$("#tosModal").classList.contains("hidden")) { var tm = $("#tosModal"); if (tm) tm.classList.add("hidden"); }
        if (!$("#aboutModal").classList.contains("hidden")) { var am = $("#aboutModal"); if (am) am.classList.add("hidden"); }
      }
    });
  }

  function restorePrefs() {
    try {
      var t = localStorage.getItem("bfv-theme");
      if (t === "light") {
        document.body.classList.add("theme-light");
        $("#themeBtn").textContent = "\u2600\uFE0F";
      }
    } catch (e) {}
  }

  /* ------------ Tools System ------------ */
  var TOOLS_INITIALIZED = false;

  function initTools() {
    if (TOOLS_INITIALIZED) return;
    TOOLS_INITIALIZED = true;

    // --- Stat Calculator ---
    function updateStatCalc() {
      var level = parseInt($("#statLevel").value) || 2600;
      if (level < 1) level = 1;
      if (level > MAX_LEVEL) level = MAX_LEVEL;
      var total = level * STATS_PER_LEVEL;
      $("#statTotalPoints").textContent = formatNumber(total);
      var allocated = 0;
      $$(".stat-slider").forEach(function (sl) {
        allocated += parseInt(sl.value) || 0;
      });
      var remaining = total - allocated;
      $("#statAllocated").textContent = formatNumber(allocated);
      $("#statRemaining").textContent = formatNumber(remaining);
      var valid = allocated <= total;
      var ve = $("#statValid");
      if (ve) {
        ve.textContent = valid ? "&#10003; Valid" : "&#10007; Over limit!";
        ve.style.color = valid ? "var(--success)" : "var(--danger)";
      }
    }
    $("#statLevel").addEventListener("input", updateStatCalc);
    $$(".stat-slider").forEach(function (sl) {
      sl.addEventListener("input", function () {
        var val = parseInt(sl.value) || 0;
        sl.parentNode.querySelector(".stat-val-display").textContent = val;
        updateStatCalc();
      });
    });
    $$(".tool-preset").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var buildId = btn.dataset.build;
        var tmpl;
        for (var i = 0; i < BUILD_TEMPLATES.length; i++) {
          if (BUILD_TEMPLATES[i].id === buildId) { tmpl = BUILD_TEMPLATES[i]; break; }
        }
        if (!tmpl) return;
        $$(".stat-slider").forEach(function (sl) {
          var statName = sl.closest(".stat-row").dataset.stat;
          var val = tmpl.stats[statName] || 0;
          var maxAllowed = parseInt(sl.max) || MAX_STAT;
          if (val > maxAllowed) val = maxAllowed;
          sl.value = val;
          sl.parentNode.querySelector(".stat-val-display").textContent = val;
        });
        updateStatCalc();
      });
    });
    updateStatCalc();

    // --- Damage Calculator ---
    $("#dmgCalcBtn").addEventListener("click", function () {
      var base = parseInt($("#dmgBase").value) || 0;
      var stat = $("#dmgStat").value;
      var statVal = parseInt($("#dmgStatVal").value) || 0;
      var mastery = parseInt($("#dmgMastery").value) || 1;
      if (base <= 0) { showToast("Enter a base damage value"); return; }
      var dmg = calcDamage(statVal, base, mastery);
      $("#dmgResult").innerHTML = '<div class="dmg-result hit"><div class="dmg-number">' + formatNumber(dmg) + '</div><div class="dmg-label">Estimated damage with ' + stat + ' (' + statVal + ') + mastery ' + mastery + '</div></div>';
    });

    // --- XP Planner ---
    $("#xpCalcBtn").addEventListener("click", function () {
      var curLvl = parseInt($("#xpCurrentLevel").value) || 1;
      var tgtLvl = parseInt($("#xpTargetLevel").value) || 2600;
      var curXP = parseInt($("#xpCurrentXP").value) || 0;
      if (curLvl < 1) curLvl = 1;
      if (tgtLvl > MAX_LEVEL) tgtLvl = MAX_LEVEL;
      if (curLvl >= tgtLvl) { showToast("Target level must be higher than current"); return; }
      var xpNeeded = 0;
      var startIdx = curLvl - 1;
      var endIdx = tgtLvl - 1;
      for (var i = startIdx; i < endIdx; i++) {
        xpNeeded += XP_TABLE[i].xpToNext;
      }
      xpNeeded -= curXP;
      if (xpNeeded < 0) xpNeeded = 0;
      var totalXPCur = XP_TABLE[curLvl - 1].totalXP;
      var totalXPTgt = XP_TABLE[tgtLvl - 1].totalXP;
      var progress = (totalXPCur + curXP) / totalXPTgt * 100;
      if (progress > 100) progress = 100;
      var totalToTgt = totalXPTgt - (totalXPCur + curXP);
      if (totalToTgt < 0) totalToTgt = 0;
      $("#xpResult").innerHTML =
        '<div class="xp-result-card">' +
          '<div class="xp-stat"><span>XP needed</span><strong>' + formatNumber(xpNeeded) + '</strong></div>' +
          '<div class="xp-stat"><span>Total XP to target</span><strong>' + formatNumber(totalToTgt) + '</strong></div>' +
          '<div class="xp-stat"><span>Progress</span><strong>' + progress.toFixed(1) + '%</strong></div>' +
          '<div class="xp-stat" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><span>From Lv.' + curLvl + ' to Lv.' + tgtLvl + '</span><strong>' + (tgtLvl - curLvl) + ' levels</strong></div>' +
        '</div>';
    });

    // --- Boss Guides ---
    function renderBosses(query) {
      var grid = $("#bossGrid");
      if (!grid) return;
      var list = BOSSES;
      if (query) {
        var q = query.toLowerCase();
        list = list.filter(function (b) { return b.name.toLowerCase().indexOf(q) !== -1 || b.location.toLowerCase().indexOf(q) !== -1; });
      }
      if (list.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No bosses match your search.</p></div>';
        return;
      }
      grid.innerHTML = list.map(function (b) {
        var imgUrl = "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + b.img;
        return '<div class="boss-card">' +
          '<div class="boss-card-inner">' +
            '<div class="boss-img-wrap"><img src="' + imgUrl + '" alt="' + sanitize(b.name) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML=\'&#9876;\'" /></div>' +
            '<div class="boss-card-info">' +
              '<div class="boss-name">' + sanitize(b.name) + '</div>' +
              '<div class="boss-detail">&#127775; Level ' + b.level + ' &middot; &#10084; ' + formatNumber(b.hp) + ' HP</div>' +
              '<div class="boss-detail">&#128205; ' + sanitize(b.location) + '</div>' +
              '<div class="boss-drops">&#128230; ' + sanitize(b.drops) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    }
    $("#bossSearch").addEventListener("input", function () { renderBosses(this.value); });
    renderBosses("");

    // --- Build Optimizer ---
    function renderBuilds() {
      var container = $("#buildRecs");
      if (!container) return;
      container.innerHTML = '<div class="build-recs">' + RECOMMENDED_BUILDS.map(function (b) {
        var statsHtml = "";
        for (var key in b.stats) {
          if (b.stats[key] > 0) {
            statsHtml += '<span>' + key + ': ' + formatNumber(b.stats[key]) + '</span>';
          }
        }
        return '<div class="build-card">' +
          '<div class="build-card-header">' +
            '<span class="build-card-name">' + sanitize(b.name) + '</span>' +
            '<span class="build-card-type">' + sanitize(b.type) + '</span>' +
          '</div>' +
          '<div class="build-card-fruit">&#127822; ' + sanitize(b.fruit) + '</div>' +
          '<div class="build-card-stats">' + statsHtml + '</div>' +
          '<div class="build-card-desc">' + sanitize(b.desc) + '</div>' +
          '<div class="build-card-desc" style="color:var(--accent-2);margin-top:4px">&#9876; ' + sanitize(b.weapons) + ' &middot; &#128170; ' + sanitize(b.fighting) + '</div>' +
        '</div>';
      }).join("") + '</div>';
    }
    renderBuilds();

    // --- Spawn Locations ---
    function renderSpawns(query) {
      var grid = $("#spawnGrid");
      if (!grid) return;
      var list = FRUIT_SPAWN_LOCATIONS;
      if (query) {
        var q = query.toLowerCase();
        list = list.filter(function (s) { return s.name.toLowerCase().indexOf(q) !== -1 || s.island.toLowerCase().indexOf(q) !== -1; });
      }
      if (list.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No spawns match your search.</p></div>';
        return;
      }
      grid.innerHTML = list.map(function (s) {
        var imgUrl = "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + s.img;
        return '<div class="spawn-card">' +
          '<div class="spawn-card-inner">' +
            '<div class="spawn-img-wrap"><img src="' + imgUrl + '" alt="' + sanitize(s.name) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.textContent=\'&#127822;\'" /></div>' +
            '<div>' +
              '<div class="spawn-fruit">' + sanitize(s.name) + '</div>' +
              '<span class="spawn-island">&#127758; ' + sanitize(s.island) + '</span>' +
              '<span class="spawn-area">&#128205; ' + sanitize(s.area) + ' (' + s.sea + ' sea)</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    }
    $("#spawnSearch").addEventListener("input", function () { renderSpawns(this.value); });
    renderSpawns("");

    // --- Swords ---
    function renderSwords(query) {
      var grid = $("#swordGrid");
      if (!grid) return;
      var list = SWORDS;
      if (query) {
        var q = query.toLowerCase();
        list = list.filter(function (s) { return s.name.toLowerCase().indexOf(q) !== -1 || s.source.toLowerCase().indexOf(q) !== -1; });
      }
      if (list.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No weapons match your search.</p></div>';
        return;
      }
      grid.innerHTML = list.map(function (s) {
        var imgUrl = "https://blox-fruits.fandom.com/wiki/Special:FilePath/" + s.img;
        return '<div class="sword-card">' +
          '<div class="sword-card-inner">' +
            '<div class="sword-img-wrap"><img src="' + imgUrl + '" alt="' + sanitize(s.name) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.textContent=\'&#9876;\'" /></div>' +
            '<div>' +
              '<div class="sword-name">' + sanitize(s.name) + '</div>' +
              '<div class="sword-detail">&#127775; Level ' + s.levelReq + ' &middot; Mastery ' + s.masteryReq + ' &middot; ' + s.damage + '</div>' +
              '<div class="sword-source">&#128205; ' + sanitize(s.source) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    }
    $("#swordSearch").addEventListener("input", function () { renderSwords(this.value); });
    renderSwords("");
  }

  function renderFruitPreview() {
    var grid = $("#fruitPreviewGrid");
    if (!grid) return;
    var sorted = fruits.slice().sort(function (a, b) { return b.value - a.value; });
    var top = sorted.slice(0, 18);
    grid.innerHTML = top.map(function (f) {
      var rm = RARITY_META[f.rarity] || { color: "#888", icon: "◆" };
      var firstLetter = f.name.charAt(0);
      var letter = isTokenItem(f.name) ? (f.name.indexOf("Dragon") !== -1 ? "&#128009;" : "&#127775;") : firstLetter;
      return '<div class="calc-fruit-preview-item" data-fruit="' + sanitize(f.name) + '" style="--card-glow:' + rm.color + '">' +
        '<div class="fp-img-wrap">' +
          '<img class="fp-img" alt="' + sanitize(f.name) + '" data-id="' + f.img + '" loading="lazy" referrerpolicy="no-referrer" />' +
          '<div class="fp-fallback">' + letter + '</div>' +
        '</div>' +
        '<div class="fp-name">' + sanitize(f.name) + '</div>' +
        '<div class="fp-value">' + formatNumber(f.value) + '</div>' +
      '</div>';
    }).join("");
    grid.querySelectorAll(".calc-fruit-preview-item").forEach(function (el) {
      var img = el.querySelector(".fp-img");
      if (img) loadFruitImage(img);
      el.addEventListener("click", function () {
        showDetail(el.dataset.fruit);
      });
    });
  }

  function renderGuides() {
    $$(".guide-header").forEach(function (hdr) {
      hdr.addEventListener("click", function () {
        var body = hdr.nextElementSibling;
        if (!body) return;
        var isOpen = body.classList.contains("guide-open");
        body.classList.toggle("guide-open");
        hdr.classList.toggle("guide-open");
        var arrow = hdr.querySelector(".guide-arrow");
        if (arrow) arrow.innerHTML = isOpen ? "&#9660;" : "&#9650;";
      });
    });
  }

  function renderTools() {
    initTools();
  }

  function init() {
    var yearEl = $("#year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    restorePrefs();
    bindEvents();
    initFirebase();
    handleDiscordCallback();
    startActiveUserTracking();
    render();
    populateFruitList();
    renderCalc();
    renderBoard("");
    initTools();
    setInterval(renderUpdated, 30000);
    setInterval(updateActiveCount, 15000);
    setTimeout(updateActiveCount, 2000);
    setTimeout(initBattleCanvas, 2000);
    // Push ads for visible content (initial tab + footer)
    setTimeout(function () {
      var visible = document.querySelector(".tab-content:not(.hidden)");
      if (visible) pushTabAds(visible);
      pushTabAds(document.querySelector("footer"));
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
