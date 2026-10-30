(function () {
  "use strict";

  const STORAGE_KEY = "cape-town-parking-atlas-v1";
  const HEADERS = [
    "ID", "Facility", "Status", "Cross-checked (Yes/No)", "Date checked", "Corrections / comments",
    "Address / cross streets", "Precinct", "Latitude", "Longitude", "GPS match / note", "Inside map area?",
    "Type", "Owner / operator", "Hourly rate (ZAR)", "Daily / max rate (ZAR)", "Bays", "Size",
    "Opening hours", "Phone", "Email", "Website / booking", "Data date", "Source URL", "Notes"
  ];
  const ALIASES = {
    "ID": ["ID", "Spot ID", "Code"],
    "Facility": ["Facility", "Name", "Parking facility", "Spot"],
    "Status": ["Status", "Access status"],
    "Cross-checked (Yes/No)": ["Cross-checked (Yes/No)", "Cross checked", "Checked"],
    "Date checked": ["Date checked", "Checked date"],
    "Corrections / comments": ["Corrections / comments", "Corrections", "Comments"],
    "Address / cross streets": ["Address / cross streets", "Address", "Location"],
    "Precinct": ["Precinct", "Area", "Neighbourhood"],
    "Latitude": ["Latitude", "Lat"],
    "Longitude": ["Longitude", "Long", "Lng", "Lon"],
    "GPS match / note": ["GPS match / note", "GPS note", "Location note"],
    "Inside map area?": ["Inside map area?", "Map area", "Inside area"],
    "Type": ["Type", "Facility type"],
    "Owner / operator": ["Owner / operator", "Operator", "Owner"],
    "Hourly rate (ZAR)": ["Hourly rate (ZAR)", "Hourly rate", "Rate"],
    "Daily / max rate (ZAR)": ["Daily / max rate (ZAR)", "Daily rate", "Max rate"],
    "Bays": ["Bays", "Capacity", "Spaces"],
    "Size": ["Size", "Facility size"],
    "Opening hours": ["Opening hours", "Hours"],
    "Phone": ["Phone", "Telephone"],
    "Email": ["Email", "Email address"],
    "Website / booking": ["Website / booking", "Website", "Booking"],
    "Data date": ["Data date", "Source date"],
    "Source URL": ["Source URL", "Source", "URL"],
    "Notes": ["Notes", "Research notes"]
  };
  const STATUSES = [
    "Confirmed public", "Researched site", "Public access unclear",
    "Possibly street parking", "Private / tenants only", "Duplicate",
    "No evidence / does not exist"
  ];
  const FORM_GROUPS = [
    {
      title: "The place",
      note: "Start with what you can see",
      fields: [
        ["ID", "Spot ID", "text", "Keep this code with the row in your spreadsheet.", "readonly"],
        ["Facility", "Facility name", "text", "A name the team will recognize.", "full"],
        ["Status", "Access status", "select-status", "What do you know about public access?"],
        ["Cross-checked (Yes/No)", "Cross-checked", "select-checked", "Choose Yes after a call or site visit."],
        ["Date checked", "Date checked", "text", "For example, 30 Oct 2026."],
        ["Precinct", "Precinct", "select-precinct", "The part of town this spot belongs to."],
        ["Type", "Facility type", "text", "For example, garage, open lot, or basement."],
        ["Owner / operator", "Owner or operator", "text", "Leave as Unconfirmed until verified.", "full"],
        ["Address / cross streets", "Address or cross streets", "textarea", "A street address or a useful set of cross streets.", "full"],
        ["Inside map area?", "Map area", "select-area", "Keep Edge or Check when the boundary needs a closer look."],
        ["GPS match / note", "Pin note", "textarea", "Explain how confidently the pin matches the entrance.", "full"]
      ]
    },
    {
      title: "Location & access",
      note: "A pin can be adjusted",
      fields: [
        ["Latitude", "Latitude", "number", "Move the pin by updating its latitude."],
        ["Longitude", "Longitude", "number", "Move the pin by updating its longitude."],
        ["Opening hours", "Opening hours", "textarea", "Include any special-day or event-day details.", "full"]
      ]
    },
    {
      title: "Rates & capacity",
      note: "Keep the original wording",
      fields: [
        ["Hourly rate (ZAR)", "Hourly rate", "textarea", "Keep tiered tariffs as written in the source.", "full"],
        ["Daily / max rate (ZAR)", "Daily or maximum rate", "textarea", "A flat rate or daily cap, if known.", "full"],
        ["Bays", "Bays", "text", "A number or a note such as “part of 1,400+”.", "full"],
        ["Size", "Size", "text", "Big, small, or unconfirmed."]
      ]
    },
    {
      title: "People & sources",
      note: "Good notes make follow-up easier",
      fields: [
        ["Phone", "Phone", "text", ""],
        ["Email", "Email", "text", ""],
        ["Website / booking", "Website or booking link", "text", "", "full"],
        ["Data date", "Date of source data", "text", "Year or approximate date is fine."],
        ["Source URL", "Source URL", "text", "Paste the page or map listing used.", "full"],
        ["Corrections / comments", "Cross-check comments", "textarea", "What changed, or what the team should ask next?", "full"],
        ["Notes", "Research notes", "textarea", "Useful details that do not fit above.", "full"]
      ]
    }
  ];

  const state = {
    spots: [],
    selectedId: null,
    filter: "all",
    search: "",
    precinct: "all",
    area: "all",
    type: "all",
    status: "all",
    sort: "review",
    map: null,
    markerLayer: null,
    markers: [],
    placing: false,
    draft: null,
    draftIsNew: false,
    toastTimer: null,
    toastAction: null,
    pendingDeleteId: null,
    apiAvailable: false
  };

  const byId = function (id) { return document.getElementById(id); };
  const mapElement = byId("map");
  const mapWrap = document.querySelector(".map-canvas-wrap");
  const detailContent = byId("detail-content");
  const listElement = byId("spot-list");
  const icon = function (name) {
    return '<svg aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  };

  function clean(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function keyOf(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function toCoordinate(value) {
    if (value === "" || value === null || value === undefined) return "";
    const result = Number(value);
    return Number.isFinite(result) ? result : "";
  }

  function normalizeRecord(source, index) {
    const lookup = {};
    Object.keys(source || {}).forEach(function (key) { lookup[keyOf(key)] = source[key]; });
    const record = {};
    HEADERS.forEach(function (header) {
      let value = "";
      for (const alias of (ALIASES[header] || [header])) {
        const candidate = lookup[keyOf(alias)];
        if (candidate !== undefined && candidate !== null) {
          value = candidate;
          break;
        }
      }
      if (header === "Latitude" || header === "Longitude") value = toCoordinate(value);
      else if (typeof value === "number" && !Number.isFinite(value)) value = "";
      record[header] = value;
    });
    if (!clean(record["ID"])) record["ID"] = "P" + String(index + 1).padStart(2, "0");
    if (!clean(record["Status"])) record["Status"] = "Researched site";
    if (!clean(record["Cross-checked (Yes/No)"])) record["Cross-checked (Yes/No)"] = "No";
    if (!clean(record["Inside map area?"])) record["Inside map area?"] = "Check";
    return record;
  }

  function normalizedStatus(value) {
    return clean(value).toLowerCase();
  }

  function markerKind(record) {
    const status = normalizedStatus(record["Status"]);
    if (status.indexOf("confirmed public") >= 0) return "confirmed";
    if (status.indexOf("unclear") >= 0 || status.indexOf("private") >= 0 ||
        status.indexOf("street") >= 0 || status.indexOf("duplicate") >= 0 ||
        status.indexOf("no evidence") >= 0) return "unclear";
    return "review";
  }

  function markerClass(record) {
    const kind = markerKind(record);
    return kind === "confirmed" ? "confirmed" : (kind === "unclear" ? "unclear" : "review");
  }

  function isChecked(record) {
    return clean(record["Cross-checked (Yes/No)"]).toLowerCase() === "yes";
  }

  function precincts() {
    return Array.from(new Set(state.spots.map(function (spot) { return clean(spot["Precinct"]); }).filter(Boolean))).sort();
  }

  function updateFilterOptions() {
    const precinctSelect = byId("precinct-filter");
    const statusSelect = byId("status-filter");
    const selectedPrecinct = state.precinct;
    const selectedStatus = state.status;
    precinctSelect.innerHTML = '<option value="all">All precincts</option>' +
      precincts().map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join("");
    statusSelect.innerHTML = '<option value="all">All access statuses</option>' +
      Array.from(new Set(state.spots.map(function (spot) { return clean(spot["Status"]); }).filter(Boolean))).sort().map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join("");
    precinctSelect.value = precincts().includes(selectedPrecinct) ? selectedPrecinct : "all";
    statusSelect.value = state.spots.some(function (spot) { return clean(spot["Status"]) === selectedStatus; }) ? selectedStatus : "all";
    byId("tab-all").textContent = String(state.spots.length);
    const checkedCount = state.spots.filter(isChecked).length;
    byId("tab-checked").textContent = String(checkedCount);
    byId("tab-review").textContent = String(state.spots.length - checkedCount);
    byId("footer-count").textContent = String(state.spots.length);
  }

  function typeMatches(record) {
    if (state.type === "all") return true;
    const type = clean(record["Type"]).toLowerCase();
    const garage = /garage|parkade|multi.storey|multi.level|parking building|basement/.test(type);
    const surface = /surface|open lot|open square|lot|car park/.test(type);
    if (state.type === "garage") return garage;
    if (state.type === "surface") return surface;
    return !garage && !surface;
  }

  function filteredSpots() {
    const needle = state.search.trim().toLowerCase();
    let result = state.spots.filter(function (spot) {
      if (state.filter === "checked" && !isChecked(spot)) return false;
      if (state.filter === "review" && isChecked(spot)) return false;
      if (state.precinct !== "all" && clean(spot["Precinct"]) !== state.precinct) return false;
      if (state.area === "Yes" && clean(spot["Inside map area?"]).toLowerCase() !== "yes") return false;
      if (state.area === "edge" && clean(spot["Inside map area?"]).toLowerCase() === "yes") return false;
      if (state.status !== "all" && clean(spot["Status"]) !== state.status) return false;
      if (!typeMatches(spot)) return false;
      if (needle) {
        const haystack = [spot["ID"], spot["Facility"], spot["Address / cross streets"], spot["Precinct"],
          spot["Owner / operator"], spot["Status"], spot["Notes"], spot["Type"]].join(" ").toLowerCase();
        if (haystack.indexOf(needle) < 0) return false;
      }
      return true;
    });

    result = result.slice();
    if (state.sort === "name") {
      result.sort(function (a, b) { return clean(a["Facility"]).localeCompare(clean(b["Facility"])); });
    } else if (state.sort === "precinct") {
      result.sort(function (a, b) {
        return clean(a["Precinct"]).localeCompare(clean(b["Precinct"])) || clean(a["Facility"]).localeCompare(clean(b["Facility"]));
      });
    } else {
      result.sort(function (a, b) {
        const score = function (spot) {
          if (isChecked(spot)) return 3;
          if (markerKind(spot) === "unclear") return 0;
          if (clean(spot["Status"]) === "Researched site") return 1;
          return 2;
        };
        return score(a) - score(b) || clean(a["Facility"]).localeCompare(clean(b["Facility"]));
      });
    }
    return result;
  }

  function pinMarkup(record, extraClass) {
    return '<div class="spot-pin ' + markerClass(record) + (extraClass ? " " + extraClass : "") +
      '" data-spot-id="' + escapeHtml(record["ID"]) + '"><svg viewBox="0 0 36 40" aria-hidden="true"><path d="M18 1.5C9 1.5 2.5 8.2 2.5 16.6c0 9.1 15.5 21.7 15.5 21.7s15.5-12.6 15.5-21.7C33.5 8.2 27 1.5 18 1.5Z"/><circle cx="18" cy="16.5" r="3.1" fill="none" stroke="#fffdf4" stroke-width="1.2"/></svg><span>' +
      escapeHtml(record["ID"]) + "</span></div>";
  }

  function coordinatesOf(record) {
    const lat = Number(record["Latitude"]);
    const lon = Number(record["Longitude"]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function initMap() {
    if (!window.L) {
      renderFallbackMap();
      return;
    }
    state.map = L.map(mapElement, {
      zoomControl: false,
      scrollWheelZoom: true,
      attributionControl: true,
      preferCanvas: true,
      minZoom: 12,
      maxZoom: 19
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      keepBuffer: 3
    }).addTo(state.map);
    L.control.zoom({ position: "bottomleft" }).addTo(state.map);
    state.markerLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 34,
      disableClusteringAtZoom: 17,
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        const size = count >= 12 ? "large" : (count >= 5 ? "medium" : "small");
        return L.divIcon({ html: "<div><span>" + count + "</span></div>", className: "marker-cluster marker-cluster-" + size, iconSize: new L.Point(36, 36) });
      }
    });
    state.map.addLayer(state.markerLayer);
    state.map.on("click", function (event) {
      if (!state.placing) return;
      createAt(event.latlng.lat, event.latlng.lng);
    });
    renderMarkers();
    fitMap();
    window.setTimeout(function () { if (state.map) state.map.invalidateSize(); }, 140);
  }

  function fitMap() {
    const visible = filteredSpots().map(coordinatesOf).filter(Boolean);
    if (!state.map || !visible.length) return;
    const bounds = L.latLngBounds(visible.map(function (pair) { return L.latLng(pair[0], pair[1]); }));
    state.map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14.8, animate: true });
  }

  function renderMarkers() {
    const visible = filteredSpots();
    byId("visible-count").textContent = String(visible.length);
    byId("map-count").textContent = String(visible.length);
    if (state.map && state.markerLayer) {
      state.markerLayer.clearLayers();
      state.markers = [];
      visible.forEach(function (spot) {
        const coords = coordinatesOf(spot);
        if (!coords) return;
        const marker = L.marker(coords, {
          icon: L.divIcon({
            className: "",
            html: pinMarkup(spot, state.selectedId === clean(spot["ID"]) ? "selected" : ""),
            iconSize: [37, 41],
            iconAnchor: [18, 36]
          }),
          title: clean(spot["Facility"]) + " · " + clean(spot["ID"]),
          alt: clean(spot["Facility"]) + " parking marker"
        });
        marker.on("click", function () { selectSpot(clean(spot["ID"]), true); });
        marker.bindTooltip(escapeHtml(spot["Facility"]) + " · " + escapeHtml(spot["ID"]), {
          direction: "top",
          offset: [0, -27],
          opacity: .96,
          className: "spot-tooltip"
        });
        state.markerLayer.addLayer(marker);
        state.markers.push({ id: clean(spot["ID"]), marker: marker });
      });
      return;
    }
    renderFallbackPins(visible);
  }

  function renderFallbackMap() {
    mapElement.classList.add("fallback-map");
    mapElement.innerHTML = '<svg class="fallback-streets" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<rect width="900" height="700" fill="#e8e5d8"/>' +
      '<path d="M-50 105h1040M-30 230h990M-30 352h990M-30 479h990M-30 600h990M130-35v770M270-35v770M407-35v770M543-35v770M680-35v770M810-35v770" stroke="#faf8ed" stroke-width="24"/>' +
      '<path d="M-50 105h1040M-30 230h990M-30 352h990M-30 479h990M-30 600h990M130-35v770M270-35v770M407-35v770M543-35v770M680-35v770M810-35v770" stroke="#c9c8b7" stroke-width="1.4" stroke-dasharray="4 4"/>' +
      '<path d="M-60 291h1000M-60 535h1000M337-40v790M746-30v780" stroke="#f0d981" stroke-width="5"/>' +
      '<path d="M26 160h74v37H26zm173 126h51v64h-51zm93 57h66v79h-66zm191-189h82v63h-82zm144 182h88v66h-88zm-437 195h76v48h-76zm356 25h92v46h-92zm154-442h67v70h-67z" fill="#d4d7c5"/>' +
      '<path d="M49 174h27m182 127h31m87 55h35m191-153h34m151 210h43m-451 128h38m370 15h46m155-407h26" stroke="#a8b39c" stroke-width="4" stroke-linecap="round"/>' +
      '<text x="24" y="94">BUITENGRACHT ST</text><text x="294" y="220">LONG ST</text><text x="550" y="475">BREE ST</text><text x="180" y="578">WALE ST</text><text x="675" y="165">STRAND ST</text>' +
      '<text x="420" y="676">CAPETOWN · FIELD MAP</text></svg><div class="fallback-caption">Street map preview · pins use the workbook coordinates</div>';
    mapElement.addEventListener("click", function (event) {
      if (!state.placing || event.target.closest(".fallback-pin")) return;
      const rect = mapElement.getBoundingClientRect();
      const pointX = (event.clientX - rect.left) / rect.width;
      const pointY = (event.clientY - rect.top) / rect.height;
      createAt(-33.911 - pointY * .034, 18.401 + pointX * .05);
    });
  }

  function renderFallbackPins(visible) {
    mapElement.querySelectorAll(".fallback-pin").forEach(function (node) { node.remove(); });
    visible.forEach(function (spot) {
      const coords = coordinatesOf(spot);
      if (!coords) return;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "fallback-pin " + markerClass(spot) + (state.selectedId === clean(spot["ID"]) ? " selected" : "");
      pin.style.left = ((coords[1] - 18.401) / .05 * 100) + "%";
      pin.style.top = ((-33.911 - coords[0]) / .034 * 100) + "%";
      pin.setAttribute("aria-label", clean(spot["Facility"]) + " · " + clean(spot["ID"]));
      pin.innerHTML = pinMarkup(spot, "");
      pin.addEventListener("click", function (event) {
        event.stopPropagation();
        selectSpot(clean(spot["ID"]), true);
      });
      mapElement.appendChild(pin);
    });
  }

  function currentSpot() {
    return state.spots.find(function (spot) { return clean(spot["ID"]) === state.selectedId; }) || null;
  }

  function renderList() {
    const spots = filteredSpots();
    byId("visible-count").textContent = String(spots.length);
    if (!spots.length) {
      listElement.innerHTML = '<div class="empty-list">' + icon("search") + '<b>No spots found yet</b><p>Try a shorter search or clear one of the filters.</p></div>';
      return;
    }
    listElement.innerHTML = spots.map(function (spot) {
      const checked = isChecked(spot);
      const kind = markerClass(spot);
      const tagClass = kind === "unclear" ? "unclear" : (!checked ? "review" : "");
      const tag = checked ? "Cross-checked" : "Needs a check";
      const address = clean(spot["Address / cross streets"]);
      return '<button class="spot-row' + (state.selectedId === clean(spot["ID"]) ? " selected" : "") +
        '" type="button" data-id="' + escapeHtml(spot["ID"]) + '">' +
        '<span class="row-marker ' + kind + '">' + icon("pin") + '<span>' + escapeHtml(spot["ID"]) + "</span></span>" +
        '<span class="spot-copy"><h3>' + escapeHtml(spot["Facility"] || "Unnamed parking spot") +
        '</h3><p>' + escapeHtml(spot["Precinct"] || "Precinct not set") + (address ? " · " + escapeHtml(address) : "") +
        '</p><span class="spot-tags"><span class="tag ' + tagClass + '">' + escapeHtml(tag) + '</span><span class="tag-precinct">' +
        escapeHtml(spot["Status"] || "") + "</span></span></span></button>";
    }).join("");
    listElement.querySelectorAll(".spot-row").forEach(function (row) {
      row.addEventListener("click", function () { selectSpot(row.getAttribute("data-id"), true); });
    });
  }

  function displayValue(value, fallback) {
    const str = clean(value);
    if (!str || str.toLowerCase() === "unconfirmed") return fallback || "Not confirmed yet";
    if (/^\d+\.0$/.test(str)) return str.slice(0, -2);
    return str;
  }

  function summaryValue(value) {
    const str = clean(value);
    if (!str) return "Not confirmed yet";
    if (str.length > 51) return str.slice(0, 48) + "…";
    return str;
  }

  function validUrl(value) {
    const url = clean(value);
    if (!/^https?:\/\//i.test(url)) return "";
    try { return new URL(url).href; } catch (e) { return ""; }
  }

  function displayWebsite(value) {
    const str = clean(value);
    if (!str || str.toLowerCase() === "unconfirmed") return "";
    return validUrl(str) || str;
  }

  function renderDetails() {
    const spot = currentSpot();
    if (!spot) {
      byId("detail-heading").textContent = "A closer look";
      byId("edit-button").disabled = true;
      byId("delete-button").disabled = true;
      detailContent.innerHTML = '<div class="detail-placeholder"><div class="empty-detail">' +
        '<div class="empty-illustration"><span>✳</span>' + icon("pin") + '</div>' +
        '<h3>Pick a pin to begin</h3><p>Choose a spot on the map or from the list to see its address, rates, notes, and what still needs checking.</p>' +
        '<div class="empty-doodle">one little field trip at a time <span>↗</span></div></div></div>';
      return;
    }
    byId("edit-button").disabled = false;
    byId("delete-button").disabled = false;
    byId("detail-heading").textContent = "Spot details";
    const kind = markerClass(spot);
    const checked = isChecked(spot);
    const checkLabel = checked ? "Cross-checked" : "Needs a check";
    const rate = summaryValue(spot["Hourly rate (ZAR)"]);
    const daily = summaryValue(spot["Daily / max rate (ZAR)"]);
    const coords = coordinatesOf(spot);
    const mapsUrl = coords ? "https://www.google.com/maps?q=" + encodeURIComponent(coords[0] + "," + coords[1]) : "";
    const streetViewUrl = coords
      ? "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + encodeURIComponent(coords[0] + "," + coords[1])
      : "";
    const source = validUrl(spot["Source URL"]);
    const website = displayWebsite(spot["Website / booking"]);
    const phone = clean(spot["Phone"]);
    const email = clean(spot["Email"]);
    const count = displayValue(spot["Bays"], "Unconfirmed");
    const correction = clean(spot["Corrections / comments"]);
    const notes = clean(spot["Notes"]);
    const sourceText = clean(spot["Source URL"]);
    const rows = [
      ["Facility type", displayValue(spot["Type"])],
      ["Operator", displayValue(spot["Owner / operator"])],
      ["Bays", count],
      ["Size", displayValue(spot["Size"])],
      ["Opening hours", displayValue(spot["Opening hours"])]
    ];
    const location = mapsUrl
      ? '<a class="source-link" href="' + escapeHtml(mapsUrl) + '" target="_blank" rel="noreferrer">' +
        escapeHtml(Number(coords[0]).toFixed(5) + ", " + Number(coords[1]).toFixed(5)) + icon("external") + "</a>"
      : '<span class="fact">No coordinates yet</span>';
    const streetView = streetViewUrl
      ? '<a class="streetview-link" href="' + escapeHtml(streetViewUrl) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="streetview-icon">' + icon("streetview") + '</span><span><b>Open Street View</b><small>See the closest street-level panorama</small></span>' +
        icon("external") + "</a>"
      : '<span class="streetview-unavailable">Add coordinates to open Street View.</span>';
    const contactParts = [];
    if (phone && phone.toLowerCase() !== "unconfirmed") contactParts.push('<div class="fact"><span>Phone</span><b>' + escapeHtml(phone) + "</b></div>");
    if (email && email.toLowerCase() !== "unconfirmed") contactParts.push('<div class="fact"><span>Email</span><b>' + escapeHtml(email) + "</b></div>");
    if (website) {
      const websiteLink = validUrl(website);
      contactParts.push('<div class="fact"><span>Website / booking</span><b>' +
        (websiteLink ? '<a class="source-link" href="' + escapeHtml(websiteLink) + '" target="_blank" rel="noreferrer">' + escapeHtml(clean(spot["Website / booking"])) + icon("external") + "</a>" : escapeHtml(website)) +
        "</b></div>");
    }
    const contactHtml = contactParts.length ? contactParts.join("") : '<span class="fact"><b>Contact details still to confirm.</b></span>';
    const noteHtml = '<div class="note-stack">' +
      '<div class="detail-note" data-label="CROSS-CHECK">' + escapeHtml(correction || "No cross-check comments yet.") + "</div>" +
      '<div class="detail-note" data-label="FIELD NOTE">' + escapeHtml(notes || "No extra research notes yet.") + "</div></div>";
    const sourceLink = source
      ? '<a class="source-link" href="' + escapeHtml(source) + '" target="_blank" rel="noreferrer">' + escapeHtml(spot["Source URL"]) + icon("external") + "</a>"
      : (sourceText ? '<span class="fact"><b>' + escapeHtml(sourceText) + "</b></span>" : '<span class="fact"><b>No source link saved yet.</b></span>');

    detailContent.innerHTML =
      '<div class="detail-card"><div class="detail-topline"><span class="spot-id">' + escapeHtml(spot["ID"]) +
      '</span><span class="detail-status ' + kind + '">' + escapeHtml(checked ? "Cross-checked" : clean(spot["Status"] || checkLabel)) + "</span></div>" +
      '<h3 class="detail-name">' + escapeHtml(spot["Facility"] || "Unnamed parking spot") + '</h3>' +
      '<div class="detail-address">' + icon("location") + '<span>' + escapeHtml(displayValue(spot["Address / cross streets"], "Address still to confirm")) + "</span></div>" +
      (clean(spot["Precinct"]) ? '<span class="detail-precinct">' + escapeHtml(spot["Precinct"]) + "</span>" : "") +
      '<div class="detail-rate"><div class="rate-stat"><span>HOURLY RATE</span><b' + (rate.length > 19 ? ' class="rate-text"' : "") + ">" + escapeHtml(rate) +
      '</b></div><div class="rate-stat"><span>DAILY / MAX</span><b' + (daily.length > 19 ? ' class="rate-text"' : "") + ">" + escapeHtml(daily) + "</b></div></div></div>" +
      '<section class="detail-section"><h3 class="section-label">THE QUICK PICTURE <i class="sketch-underline"></i></h3><div class="facts-grid">' +
      rows.map(function (row) { return '<div class="fact"><span>' + escapeHtml(row[0]) + "</span><b>" + escapeHtml(row[1]) + "</b></div>"; }).join("") +
      '<div class="fact"><span>Cross-check</span><b>' + escapeHtml(checkLabel) + "</b></div>" +
      '<div class="fact"><span>Checked on</span><b>' + escapeHtml(displayValue(spot["Date checked"], "Date not recorded")) + "</b></div>" +
      '<div class="fact"><span>Map area</span><b>' + escapeHtml(displayValue(spot["Inside map area?"])) + "</b></div>" +
      '<div class="fact"><span>Pin coordinates</span><b>' + location + "</b></div>" +
      '<div class="fact fact-wide streetview-fact"><span>STREET-LEVEL LOOK</span>' + streetView + "</div></div></section>" +
      '<section class="detail-section"><h3 class="section-label">NOTES FOR THE NEXT VISIT <i class="sketch-underline"></i></h3>' + noteHtml + "</section>" +
      '<section class="detail-section"><h3 class="section-label">CONTACT & SOURCES <i class="sketch-underline"></i></h3><div class="facts-grid">' +
      contactHtml + '<div class="fact"><span>Research source</span><b>' + sourceLink + "</b></div></div>" +
      '<div class="coordinate-note">Source data: ' + escapeHtml(displayValue(spot["Data date"], "Date not recorded")) +
      (clean(spot["GPS match / note"]) ? " · Pin note: " + escapeHtml(spot["GPS match / note"]) : "") + "</div></section>";
  }

  function selectSpot(id, panTo) {
    const spot = state.spots.find(function (item) { return clean(item["ID"]) === id; });
    if (!spot) return;
    state.selectedId = id;
    renderList();
    renderDetails();
    renderMarkers();
    document.body.classList.add("is-detail-open");
    if (panTo && state.map) {
      const coords = coordinatesOf(spot);
      if (coords) state.map.setView(coords, Math.max(state.map.getZoom(), 15), { animate: true });
    }
  }

  function renderEverything() {
    updateFilterOptions();
    renderList();
    renderDetails();
    renderMarkers();
  }

  function showToast(message, actionLabel, actionCallback) {
    const toast = byId("toast");
    const action = byId("toast-action");
    byId("toast-message").textContent = message;
    state.toastAction = typeof actionCallback === "function" ? actionCallback : null;
    action.hidden = !state.toastAction;
    action.textContent = actionLabel || "";
    toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      toast.classList.remove("visible");
      state.toastAction = null;
      action.hidden = true;
    }, state.toastAction ? 5000 : 2600);
  }

  function persistData(announce) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.spots));
      byId("save-label").textContent = state.apiAvailable ? "Shared atlas synced" : "Saved on this device";
      byId("save-label").parentElement.classList.toggle("is-offline", !state.apiAvailable);
      if (announce !== false && !state.apiAvailable) showToast("Your field notes are saved on this device.");
      return true;
    } catch (error) {
      byId("save-label").textContent = "Could not save locally";
      if (announce !== false) showToast("This browser could not save the changes. Try exporting a copy.");
      return false;
    }
  }

  function setApiStatus(available, label) {
    state.apiAvailable = available;
    byId("save-label").textContent = label || (available ? "Shared atlas connected" : "Saved on this device");
    byId("save-label").parentElement.classList.toggle("is-offline", !available);
  }

  async function sendToSharedAtlas(url, method, body) {
    const response = await fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    });
    if (!response.ok) {
      let message = "The shared save could not be completed.";
      try {
        const result = await response.json();
        if (result && result.error) message = result.error;
      } catch (error) {}
      throw new Error(message);
    }
    return response;
  }

  async function syncSpot(spot, method, announce) {
    if (!state.apiAvailable) {
      if (announce) showToast("Saved on this device. Open the app on its shared Node server to sync changes.");
      return;
    }
    setApiStatus(true, "Syncing shared atlas…");
    try {
      const url = method === "POST" ? "/api/spots" : "/api/spots/" + encodeURIComponent(clean(spot["ID"]));
      await sendToSharedAtlas(url, method, spot);
      setApiStatus(true, "Shared atlas synced");
      if (announce) showToast("Saved to the shared atlas.");
    } catch (error) {
      setApiStatus(false, "Shared sync unavailable");
      showToast("Saved on this device; the shared save did not finish. Check the connection before closing this page.");
    }
  }

  async function syncDeletedSpot(id) {
    if (!state.apiAvailable) return;
    setApiStatus(true, "Syncing shared atlas…");
    try {
      await sendToSharedAtlas("/api/spots/" + encodeURIComponent(id), "DELETE");
      setApiStatus(true, "Shared atlas synced");
    } catch (error) {
      setApiStatus(false, "Shared sync unavailable");
      showToast("Saved on this device; the shared delete did not finish. Check the connection before closing this page.");
    }
  }

  async function syncImportedSpots(records) {
    if (!state.apiAvailable) {
      showToast("Imported on this device. Open the app on its shared Node server to sync changes.");
      return;
    }
    setApiStatus(true, "Syncing shared atlas…");
    try {
      await sendToSharedAtlas("/api/spots/import", "PUT", { spots: records });
      setApiStatus(true, "Shared atlas synced");
      showToast("Imported " + records.length + " parking spots to the shared atlas.");
    } catch (error) {
      setApiStatus(false, "Shared sync unavailable");
      showToast("Imported on this device; the shared import did not finish. Check the connection before closing this page.");
    }
  }

  function addOptions(values, chosen, blankLabel) {
    const distinct = Array.from(new Set(values.concat(chosen ? [chosen] : []))).filter(Boolean).sort();
    return (blankLabel ? '<option value="">Choose one…</option>' : "") + distinct.map(function (value) {
      return '<option value="' + escapeHtml(value) + '"' + (value === chosen ? " selected" : "") + ">" + escapeHtml(value) + "</option>";
    }).join("");
  }

  function fieldMarkup(field, record, index) {
    const key = field[0];
    const label = field[1];
    const type = field[2];
    const help = field[3];
    const extra = field[4] || "";
    const id = "edit-field-" + index;
    const value = clean(record[key]);
    let control = "";
    if (type === "select-status") {
      const options = Array.from(new Set(STATUSES.concat(state.spots.map(function (spot) { return clean(spot["Status"]); })).concat([value]))).filter(Boolean);
      control = '<select id="' + id + '" name="' + escapeHtml(key) + '">' + addOptions(options, value, true) + "</select>";
    } else if (type === "select-checked") {
      control = '<select id="' + id + '" name="' + escapeHtml(key) + '">' + addOptions(["No", "Yes"], value, false) + "</select>";
    } else if (type === "select-area") {
      control = '<select id="' + id + '" name="' + escapeHtml(key) + '">' + addOptions(["Yes", "Edge", "Check"], value, false) + "</select>";
    } else if (type === "select-precinct") {
      control = '<select id="' + id + '" name="' + escapeHtml(key) + '">' + addOptions(precincts(), value, true) + "</select>";
    } else if (type === "textarea") {
      control = '<textarea id="' + id + '" name="' + escapeHtml(key) + '" placeholder="Leave blank if you do not know yet">' + escapeHtml(value) + "</textarea>";
    } else {
      const inputType = type === "number" ? ' type="number" step="any"' : ' type="text"';
      const readOnly = extra === "readonly" ? " readonly" : "";
      const placeholder = value ? "" : ' placeholder="Leave blank if you do not know yet"';
      control = '<input id="' + id + '"' + inputType + ' name="' + escapeHtml(key) + '" value="' + escapeHtml(value) + '"' + placeholder + readOnly + ">";
    }
    return '<div class="field ' + (extra === "full" || type === "textarea" ? "full" : "") + '">' +
      '<label for="' + id + '">' + escapeHtml(label) + "</label>" + control +
      (help ? '<span class="help">' + escapeHtml(help) + "</span>" : "") + "</div>";
  }

  function openEditor(spot, isNew) {
    state.draft = JSON.parse(JSON.stringify(spot));
    state.draftIsNew = Boolean(isNew);
    byId("editor-title").textContent = isNew ? "Add a parking spot" : "Edit this parking spot";
    const target = byId("editor-fields");
    let fieldIndex = 0;
    target.innerHTML = FORM_GROUPS.map(function (group) {
      const fields = group.fields.map(function (field) {
        const markup = fieldMarkup(field, state.draft, fieldIndex);
        fieldIndex += 1;
        return markup;
      }).join("");
      return '<section class="field-group' + (group.title === "People & sources" ? " wide" : "") + '">' +
        '<h3 class="field-group-title">' + escapeHtml(group.title) + "<span>" + escapeHtml(group.note) + "</span></h3>" +
        '<div class="field-grid">' + fields + "</div></section>";
    }).join("");
    byId("editor-backdrop").hidden = false;
    document.body.classList.add("modal-open");
    const first = byId("edit-field-1") || byId("edit-field-0");
    if (first && !first.readOnly) window.setTimeout(function () { first.focus(); }, 40);
  }

  function closeEditor() {
    byId("editor-backdrop").hidden = true;
    document.body.classList.remove("modal-open");
    state.draft = null;
    state.draftIsNew = false;
  }

  function nextSpotId() {
    const highest = state.spots.reduce(function (max, spot) {
      const match = /^P(\d+)$/i.exec(clean(spot["ID"]));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return "P" + String(highest + 1).padStart(2, "0");
  }

  function newSpot(lat, lon) {
    const row = {};
    HEADERS.forEach(function (header) { row[header] = ""; });
    row["ID"] = nextSpotId();
    row["Facility"] = "New parking spot";
    row["Status"] = "Researched site";
    row["Cross-checked (Yes/No)"] = "No";
    row["Latitude"] = Number(lat.toFixed(6));
    row["Longitude"] = Number(lon.toFixed(6));
    row["Inside map area?"] = "Check";
    row["Type"] = "Parking facility";
    row["Owner / operator"] = "Unconfirmed";
    row["Hourly rate (ZAR)"] = "Unconfirmed";
    row["Daily / max rate (ZAR)"] = "Unconfirmed";
    row["Bays"] = "Unconfirmed";
    row["Opening hours"] = "Unconfirmed";
    row["Data date"] = "2026";
    return row;
  }

  function createAt(lat, lon) {
    state.placing = false;
    mapWrap.classList.remove("is-placing");
    byId("map-hint").classList.add("hidden");
    openEditor(newSpot(lat, lon), true);
  }

  function beginPlaceMode() {
    state.placing = true;
    mapWrap.classList.add("is-placing");
    byId("map-hint").classList.remove("hidden");
    byId("map-hint").querySelector("span").textContent = "Tap the map where you found a new parking spot.";
    showToast("Choose the spot’s location on the map.");
    if (window.innerWidth <= 920) byId("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function requestDelete() {
    const spot = currentSpot();
    if (!spot) return;
    state.pendingDeleteId = clean(spot["ID"]);
    byId("delete-target").textContent = clean(spot["Facility"]) + " · " + clean(spot["ID"]);
    byId("delete-backdrop").hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(function () { byId("confirm-delete").focus(); }, 30);
  }

  function closeDeleteDialog() {
    byId("delete-backdrop").hidden = true;
    document.body.classList.remove("modal-open");
    state.pendingDeleteId = null;
  }

  function clearAllFilters() {
    state.filter = "all";
    state.search = "";
    state.precinct = "all";
    state.area = "all";
    state.type = "all";
    state.status = "all";
    byId("search-input").value = "";
    byId("precinct-filter").value = "all";
    byId("area-filter").value = "all";
    byId("type-filter").value = "all";
    byId("status-filter").value = "all";
    document.querySelectorAll(".filter-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.filter === "all");
    });
  }

  function restoreDeletedSpot(spot, index, originalId) {
    if (state.spots.some(function (item) { return clean(item["ID"]) === clean(spot["ID"]); })) {
      spot["ID"] = nextSpotId();
    }
    const restoredId = clean(spot["ID"]);
    state.spots.splice(Math.min(index, state.spots.length), 0, spot);
    state.selectedId = restoredId;
    clearAllFilters();
    renderEverything();
    persistData(false);
    syncSpot(spot, "PUT", false);
    document.body.classList.add("is-detail-open");
    if (state.map) {
      const point = coordinatesOf(spot);
      if (point) state.map.setView(point, Math.max(state.map.getZoom(), 15), { animate: true });
    }
    showToast(restoredId === originalId ? "Spot restored." : "Spot restored as " + restoredId + ".");
  }

  function confirmDelete() {
    const id = state.pendingDeleteId;
    const index = state.spots.findIndex(function (spot) { return clean(spot["ID"]) === id; });
    if (index < 0) {
      closeDeleteDialog();
      return;
    }
    const removed = state.spots.splice(index, 1)[0];
    const removedName = clean(removed["Facility"]) || "Parking spot";
    const originalId = clean(removed["ID"]);
    closeDeleteDialog();
    state.selectedId = state.spots.length
      ? clean(state.spots[Math.min(index, state.spots.length - 1)]["ID"])
      : null;
    clearAllFilters();
    renderEverything();
    persistData(false);
    syncDeletedSpot(originalId);
    if (!state.selectedId) document.body.classList.remove("is-detail-open");
    else document.body.classList.add("is-detail-open");
    if (state.map) fitMap();
    showToast(removedName + " removed.", "Undo", function () {
      restoreDeletedSpot(removed, index, originalId);
    });
  }

  function setupEvents() {
    byId("search-input").addEventListener("input", function (event) {
      state.search = event.target.value || "";
      renderList();
      renderMarkers();
    });
    document.querySelectorAll(".filter-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        state.filter = button.dataset.filter;
        document.querySelectorAll(".filter-tab").forEach(function (tab) { tab.classList.toggle("active", tab === button); });
        renderList();
        renderMarkers();
      });
    });
    byId("precinct-filter").addEventListener("change", function (event) {
      state.precinct = event.target.value;
      renderList();
      renderMarkers();
    });
    byId("area-filter").addEventListener("change", function (event) {
      state.area = event.target.value;
      renderList();
      renderMarkers();
    });
    byId("type-filter").addEventListener("change", function (event) {
      state.type = event.target.value;
      renderList();
      renderMarkers();
    });
    byId("status-filter").addEventListener("change", function (event) {
      state.status = event.target.value;
      renderList();
      renderMarkers();
    });
    byId("sort-select").addEventListener("change", function (event) {
      state.sort = event.target.value;
      renderList();
    });
    byId("fit-map").addEventListener("click", fitMap);
    byId("reset-filters").addEventListener("click", function () {
      state.filter = "all";
      state.search = "";
      state.precinct = "all";
      state.area = "all";
      state.type = "all";
      state.status = "all";
      byId("search-input").value = "";
      byId("precinct-filter").value = "all";
      byId("area-filter").value = "all";
      byId("type-filter").value = "all";
      byId("status-filter").value = "all";
      document.querySelectorAll(".filter-tab").forEach(function (tab) { tab.classList.toggle("active", tab.dataset.filter === "all"); });
      renderList();
      renderMarkers();
      fitMap();
    });
    byId("add-button").addEventListener("click", beginPlaceMode);
    byId("edit-button").addEventListener("click", function () {
      const spot = currentSpot();
      if (spot) openEditor(spot, false);
    });
    byId("delete-button").addEventListener("click", requestDelete);
    byId("cancel-delete").addEventListener("click", closeDeleteDialog);
    byId("confirm-delete").addEventListener("click", confirmDelete);
    byId("delete-backdrop").addEventListener("click", function (event) {
      if (event.target === byId("delete-backdrop")) closeDeleteDialog();
    });
    byId("toast-action").addEventListener("click", function () {
      const callback = state.toastAction;
      if (!callback) return;
      state.toastAction = null;
      window.clearTimeout(state.toastTimer);
      byId("toast").classList.remove("visible");
      byId("toast-action").hidden = true;
      callback();
    });
    byId("close-detail").addEventListener("click", function () { document.body.classList.remove("is-detail-open"); });
    byId("editor-form").addEventListener("submit", function (event) {
      event.preventDefault();
      if (!state.draft) return;
      const values = new FormData(event.currentTarget);
      const updated = Object.assign({}, state.draft);
      HEADERS.forEach(function (header) {
        const value = values.has(header) ? clean(values.get(header)) : clean(updated[header]);
        if (header === "Latitude" || header === "Longitude") updated[header] = toCoordinate(value);
        else updated[header] = value;
      });
      if (!updated["ID"]) updated["ID"] = nextSpotId();
      if (!updated["Facility"]) updated["Facility"] = "New parking spot";
      if (!updated["Status"]) updated["Status"] = "Researched site";
      if (!updated["Cross-checked (Yes/No)"]) updated["Cross-checked (Yes/No)"] = "No";
      const wasNew = state.draftIsNew;
      if (wasNew) state.spots.push(updated);
      else {
        const position = state.spots.findIndex(function (spot) { return clean(spot["ID"]) === clean(state.draft["ID"]); });
        if (position >= 0) state.spots[position] = updated;
      }
      state.selectedId = clean(updated["ID"]);
      state.filter = "all";
      byId("search-input").value = "";
      state.search = "";
      state.precinct = "all";
      state.area = "all";
      state.type = "all";
      state.status = "all";
      byId("precinct-filter").value = "all";
      byId("area-filter").value = "all";
      byId("type-filter").value = "all";
      byId("status-filter").value = "all";
      document.querySelectorAll(".filter-tab").forEach(function (tab) { tab.classList.toggle("active", tab.dataset.filter === "all"); });
      closeEditor();
      renderEverything();
      persistData(false);
      syncSpot(updated, wasNew ? "POST" : "PUT", true);
      document.body.classList.add("is-detail-open");
      if (state.map) {
        const point = coordinatesOf(updated);
        if (point) state.map.setView(point, Math.max(state.map.getZoom(), 15), { animate: true });
      }
    });
    byId("close-editor").addEventListener("click", closeEditor);
    byId("cancel-editor").addEventListener("click", closeEditor);
    byId("editor-backdrop").addEventListener("click", function (event) {
      if (event.target === byId("editor-backdrop")) closeEditor();
    });
    byId("import-button").addEventListener("click", function () { byId("import-file").click(); });
    byId("import-file").addEventListener("change", importWorkbook);
    byId("export-button").addEventListener("click", exportWorkbook);
    byId("dismiss-hint").addEventListener("click", function () { byId("map-hint").classList.add("hidden"); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        event.preventDefault();
        byId("search-input").focus();
      }
      if (event.key === "Escape") {
        closeEditor();
        closeDeleteDialog();
        document.body.classList.remove("is-detail-open");
        if (state.placing) {
          state.placing = false;
          mapWrap.classList.remove("is-placing");
        }
      }
    });
  }

  function importedRows(workbook) {
    const sheet = workbook.Sheets["Parking facilities"] || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("There is no worksheet to import.");
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const headerRow = matrix.findIndex(function (row) {
      const values = row.map(keyOf);
      return values.includes(keyOf("Facility")) && values.includes(keyOf("ID"));
    });
    if (headerRow < 0) throw new Error("I could not find the Facility and ID column headings.");
    const headers = matrix[headerRow].map(clean);
    return matrix.slice(headerRow + 1).map(function (row) {
      const item = {};
      headers.forEach(function (header, index) { if (header) item[header] = row[index]; });
      return item;
    }).filter(function (item) { return clean(item.Facility || item.Name); });
  }

  function importWorkbook(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!window.XLSX) {
      showToast("Excel tools are still loading. Please try again in a moment.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = function () { showToast("That file could not be opened."); };
    reader.onload = function (loadEvent) {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: "array", cellDates: false });
        const rows = importedRows(workbook);
        if (!rows.length) throw new Error("I could not find any parking facilities in that sheet.");
        state.spots = rows.map(function (row, index) { return normalizeRecord(row, index); });
        state.selectedId = state.spots[0] ? clean(state.spots[0]["ID"]) : null;
        state.filter = "all";
        state.search = "";
        state.precinct = "all";
        state.area = "all";
        state.type = "all";
        state.status = "all";
        byId("search-input").value = "";
        byId("precinct-filter").value = "all";
        byId("area-filter").value = "all";
        byId("type-filter").value = "all";
        byId("status-filter").value = "all";
        document.querySelectorAll(".filter-tab").forEach(function (tab) { tab.classList.toggle("active", tab.dataset.filter === "all"); });
        renderEverything();
        persistData(false);
        syncImportedSpots(state.spots);
      } catch (error) {
        showToast(error.message || "I could not read that spreadsheet.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function exportWorkbook() {
    const button = byId("export-button");
    if (!window.XLSX) {
      showToast("Excel tools are still loading. Please try again in a moment.");
      return;
    }
    button.disabled = true;
    button.querySelector("span").textContent = "Preparing…";
    try {
      const response = await fetch("./assets/inner-city-parking-template.xlsx");
      if (!response.ok) throw new Error("The spreadsheet template could not be loaded.");
      const sourceBytes = await response.arrayBuffer();
      const workbook = XLSX.read(sourceBytes, { type: "array", cellStyles: true, cellDates: false });
      let sheet = workbook.Sheets["Parking facilities"];
      if (!sheet) throw new Error("The parking worksheet is missing from the template.");
      const oldRange = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 4, c: 24 } };
      const lastRow = Math.max(oldRange.e.r, 4 + state.spots.length);
      for (let row = 4; row <= lastRow; row += 1) {
        for (let col = 0; col < HEADERS.length; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          delete sheet[address];
        }
      }
      const rows = state.spots.map(function (spot) {
        return HEADERS.map(function (header) { return spot[header] === undefined || spot[header] === null ? "" : spot[header]; });
      });
      if (rows.length) XLSX.utils.sheet_add_aoa(sheet, rows, { origin: "A5" });
      const endRow = Math.max(4, 4 + state.spots.length);
      sheet["!ref"] = "A1:Y" + endRow;
      sheet["!autofilter"] = { ref: "A4:Y" + endRow };
      workbook.Workbook = workbook.Workbook || {};
      workbook.Workbook.CalcPr = Object.assign({}, workbook.Workbook.CalcPr || {}, { fullCalcOnLoad: true, forceFullCalc: true });
      const output = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
      const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "Inner city parking Cape Town - updated.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      showToast("Your updated Excel workbook is ready.");
    } catch (error) {
      showToast(error.message || "The workbook could not be exported.");
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "Download Excel";
    }
  }

  async function start() {
    let rows = [];
    let loadedFromServer = false;
    try {
      const response = await fetch("/api/spots", { credentials: "same-origin" });
      if (response.ok) {
        const sharedRows = await response.json();
        if (!Array.isArray(sharedRows)) throw new Error("The shared spot list is invalid.");
        rows = sharedRows;
        loadedFromServer = true;
        setApiStatus(true, "Shared atlas connected");
      }
    } catch (e) {
      rows = [];
    }
    if (!loadedFromServer) {
      setApiStatus(false, "Saved on this device");
      try {
        const response = await fetch("./spots.json");
        if (response.ok) rows = await response.json();
      } catch (e) {
        rows = [];
      }
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!loadedFromServer && saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) rows = parsed;
      }
    } catch (e) {
      byId("save-label").textContent = "Local notes unavailable";
    }
    state.spots = rows.map(function (row, index) { return normalizeRecord(row, index); });
    if (loadedFromServer) persistData(false);
    const first = state.spots.find(function (spot) { return !isChecked(spot); }) || state.spots[0];
    state.selectedId = first ? clean(first["ID"]) : null;
    setupEvents();
    initMap();
    renderEverything();
    if (state.selectedId) document.body.classList.add("is-detail-open");
    window.addEventListener("resize", function () {
      if (state.map) window.setTimeout(function () { state.map.invalidateSize(); }, 100);
    });
  }

  start();
}());
