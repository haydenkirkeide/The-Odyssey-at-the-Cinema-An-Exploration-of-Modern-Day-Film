// Settings
const FILES = { films: "data/films.json", counts: "data/year_counts.json", meta: "data/meta.json" };
const BIG_BOX_TIERS = ["Major studio"];
const TIER_ORDER = ["Major studio", "Studio specialty arm", "Mini-major", "Streamer",
                    "Independent/other", "Unknown (no companies listed)"];
const TIER_COLORS = {
  "Major studio": "#136787",
  "Studio specialty arm": "#00e054",
  "Mini-major": "#ff8000",
  "Streamer": "#E50914",
  "Independent/other": "#f07fe3",
  "Unknown (no companies listed)": "#c3c2b7",
};
const MEASURES = { all: "All titles", feature: "Feature films", notable: "Notable films" };
const BLUE = "#00e054", BLUE_LIGHT = "#00e05466", MUTED_FILL = "#445566", NEUTRAL = "#8899aa";   // Letterboxd green bars; dim partial year
const BAR_STEP = 1, EXPLORE_STEP = 6;       // change these if you add or reorder steps
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DURATION = REDUCED_MOTION ? 0 : 900;
const margin = { top: 24, right: 16, bottom: 44, left: 60 };

// State/chart skeleton
const state = { step: 0, measure: "all", year: null, hiddenTiers: new Set(), genre: "All" };
let films = [], counts = [], meta = {}, stats = {};
let width = 0, height = 0; // inner plot size, set in resize()

const svg = d3.select("#chart");
const plot = svg.append("g");
const gGridY = plot.append("g").attr("class", "axis");
const gX = plot.append("g").attr("class", "axis");
const gY = plot.append("g").attr("class", "axis");
const xLabel = plot.append("text").attr("class", "axis-label").attr("text-anchor", "end");
const yLabel = plot.append("text").attr("class", "axis-label").attr("text-anchor", "start");
const gBars = plot.append("g").attr("opacity", 0); // the year bar chart
const medianPath = plot.append("path").attr("class", "median-line").attr("opacity", 0);
const hideMedian = () => medianPath.interrupt().attr("opacity", 0);
const gDots = plot.append("g");
const tooltip = d3.select("#tooltip");

const fmtInt = d3.format(",");
const fmtPct = d3.format(".0%");
const fmtSignedPct = d3.format("+.0%");
const fmtVotes = d3.format(".2~s");
const shortYear = yr => `'${String(yr).slice(2)}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const niceDate = iso => d3.timeFormat("%B %-d, %Y")(d3.timeParse("%Y-%m-%d")(iso));
const jitter = d => (((d.id * 9301 + 49297) % 233280) / 233280) - 0.5; // fixed by film

// Load data
Promise.all([d3.json(FILES.films), d3.json(FILES.counts), d3.json(FILES.meta)])
  .then(([rawFilms, rawCounts, rawMeta]) => {
    films = rawFilms.map(d => ({ ...d, year: +d.year, runtime: +d.runtime, rating: +d.rating, votes: +d.votes }));
    counts = rawCounts.map(d => ({ year: +d.year, all: +d.all, feature: +d.feature, notable: +d.notable }))
                      .sort((a, b) => a.year - b.year);
    meta = rawMeta;
    computeStats();
    fillText();
    buildLegend();
    buildControls();
    drawDots();
    resize();
    setupScroller();
  })

// Numbers quoted in text
function computeStats() {
  const years = counts.map(d => d.year);
  const latestYear = d3.max(years);
  const partial = meta.latest_release < `${latestYear}-12-31`;
  const lastFullYear = partial ? latestYear - 1 : latestYear;
  const full = counts.filter(d => d.year <= lastFullYear);
  const peak = d3.greatest(full, d => d.all);
  const c = y => counts.find(d => d.year === y);

  const votesSorted = films.map(d => d.votes).sort(d3.descending);
  const top5 = votesSorted.slice(0, Math.ceil(films.length * 0.05));
  const filmYears = [...new Set(films.map(d => d.year))].sort(d3.ascending);
  const medianRt = y => d3.median(films.filter(d => d.year === y), d => d.runtime);
  const meanRating = f => d3.mean(films.filter(f), d => d.rating);
  const capped = meta.films_shown < meta.notable_total;

  stats = {
    years, partial, lastFullYear, filmYears, firstYear: years[0],
    releasedTotal: fmtInt(meta.released_2016_plus),
    latestRelease: niceDate(meta.latest_release),
    generated: niceDate(meta.generated),
    notableMinVotes: fmtInt(meta.notable_min_imdb_votes),
    dotIntro: capped
      ? `These dots are ${fmtInt(meta.films_shown)} films with the most votes out of the ${fmtInt(meta.notable_total)} notable films released since 2016. Notable means a feature film with at least ${fmtInt(meta.notable_min_imdb_votes)} IMDb votes.`
      : `These are all ${fmtInt(meta.notable_total)} notable films released since 2016. Notable means a feature film with at least ${fmtInt(meta.notable_min_imdb_votes)} IMDb votes.`,
    peakYear: peak ? peak.year : "–",
    peakCount: peak ? fmtInt(peak.all) : "–",
    change2020: c(2019) && c(2020) && c(2020).year <= lastFullYear ? fmtSignedPct(c(2020).all / c(2019).all - 1) : "–",
    bigBoxShare: fmtPct(d3.mean(films, d => BIG_BOX_TIERS.includes(d.tier))),
    indieShare: fmtPct(d3.mean(films, d => d.tier === "Independent/other")),
    top5Share: fmtPct(d3.sum(top5) / d3.sum(votesSorted)),
    top5Threshold: top5[top5.length - 1],
    rtFirst: `${Math.round(medianRt(filmYears[0]))} min`,
    rtLast: `${Math.round(medianRt(lastFullYear))} min`,
    ratingLong: (meanRating(d => d.runtime >= 150) ?? NaN).toFixed(1),
    ratingShort: (meanRating(d => d.runtime < 90) ?? NaN).toFixed(1),
  };
}

function fillText() {
  d3.selectAll("[data-stat]").text(function () {
    const v = stats[this.dataset.stat];
    return v === undefined || v === "NaN" || v === "NaN min" ? "–" : v;
  });
}

// Dots, legend, controls
function drawDots() {
  gDots.selectAll("circle")
    .data(films, d => d.id)
    .join("circle")
    .attr("class", "dot")
    .attr("r", 0)
    .on("mouseenter", (event, d) => showTooltip(event,
      `<strong>${esc(d.title)} (${d.year})</strong><span class="meta">${esc(d.tier)} • ${esc(d.genre)}<br>
       ${d.runtime} min • IMDb ${d.rating.toFixed(1)} • ${fmtVotes(d.votes)} votes</span>`))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);
}

function buildLegend() {
  const present = TIER_ORDER.filter(t => films.some(d => d.tier === t));
  d3.select("#legend").selectAll("button")
    .data(present)
    .join("button")
    .attr("type", "button")
    .attr("aria-pressed", "true")
    .html(t => `<span class="swatch" style="background:${TIER_COLORS[t]}"></span>${t}`)
    .on("click", (event, tier) => {
      if (state.step !== EXPLORE_STEP) return; // filters work in last step
      state.hiddenTiers.has(tier) ? state.hiddenTiers.delete(tier) : state.hiddenTiers.add(tier);
      d3.select(event.currentTarget).attr("aria-pressed", !state.hiddenTiers.has(tier));
      render(false);
    });
}

function buildControls() {
  // Bar chart
  d3.selectAll(".ctl-bars button").on("click", event => {
    state.measure = event.currentTarget.dataset.measure;
    d3.selectAll(".ctl-bars button").attr("aria-pressed", function () { return this.dataset.measure === state.measure; });
    render(true);
  });
  // Explorer
  const genres = ["All", ...[...new Set(films.map(d => d.genre))].sort()];
  d3.select("#genre-select")
    .on("change", event => { state.genre = event.target.value; render(false); })
    .selectAll("option").data(genres).join("option").attr("value", d => d).text(d => d);
  d3.select("#reset-filters").on("click", () => {
    state.genre = "All"; state.hiddenTiers.clear(); state.year = null;
    d3.select("#genre-select").property("value", "All");
    d3.selectAll("#legend button").attr("aria-pressed", "true");
    render(false);
  });
}

// Layout helpers
const xBand = d3.scaleBand().paddingInner(0.18).paddingOuter(0.05);
const xLin = d3.scaleLinear();
const yLin = d3.scaleLinear();
const rVotes = d3.scaleSqrt();

function layoutGrid() {
  const n = films.length;
  const cols = Math.ceil(Math.sqrt((n * width) / height));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(width / cols, height / rows);
  const x0 = (width - cols * cell) / 2, y0 = (height - rows * cell) / 2;
  films.slice()
    .sort((a, b) => d3.ascending(a.year, b.year) || d3.ascending(a.id, b.id))
    .forEach((d, i) => {
      d.tx = x0 + ((i % cols) + 0.5) * cell;
      d.ty = y0 + (Math.floor(i / cols) + 0.5) * cell;
      d.tr = Math.max(1, cell * 0.4);
    });
}

function layoutYearStacks() {
  xBand.domain(stats.filmYears).range([0, width]);
  const bw = xBand.bandwidth();
  const groups = d3.group(films, d => d.year);
  const maxCount = d3.max(groups.values(), v => v.length);
  let cell = Math.min(bw, height), perRow = 1;
  for (; cell > 1.2; cell -= 0.2) { // largest cell size where tallest column is
    perRow = Math.max(1, Math.floor(bw / cell));
    if (Math.ceil(maxCount / perRow) * cell <= height) break;
  }
  const tierRank = t => TIER_ORDER.indexOf(t);
  groups.forEach((arr, year) => {
    arr.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || d3.descending(a.votes, b.votes))
      .forEach((d, i) => {
        d.tx = xBand(year) + (bw - perRow * cell) / 2 + ((i % perRow) + 0.5) * cell;
        d.ty = height - (Math.floor(i / perRow) + 0.5) * cell;
        d.tr = Math.max(0.9, cell * 0.4);
      });
  });
}

function setAxes({ x = null, y = null, xTitle = "", yTitle = "", band = false, yFormat = null }) {
  const t = svg.transition().duration(DURATION);
  gX.attr("transform", `translate(0,${height})`);
  if (x) {
    const axis = band ? d3.axisBottom(x).tickFormat(shortYear).tickSizeOuter(0)
                      : d3.axisBottom(x).ticks(6).tickSizeOuter(0);
    gX.transition(t).attr("opacity", 1).call(axis);
  } else gX.transition(t).attr("opacity", 0);
  if (y) {
    gY.transition(t).attr("opacity", 1).call(d3.axisLeft(y).ticks(6, yFormat).tickSizeOuter(0));
    gGridY.transition(t).attr("opacity", 1)
      .call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(""))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").attr("class", "grid"));
  } else {
    gY.transition(t).attr("opacity", 0);
    gGridY.transition(t).attr("opacity", 0);
  }
  xLabel.attr("x", width).attr("y", height + 38).text(xTitle);
  yLabel.attr("x", -margin.left + 4).attr("y", -10).text(yTitle);
}

function hideDots() { films.forEach(d => { d.topacity = 0; }); }

// Movies per year bar chart
function drawYearBarChart() {
  const key = state.measure;
  xBand.domain(stats.years).range([0, width]);
  yLin.domain([0, d3.max(counts, d => d[key])]).nice().range([height, 0]);
  setAxes({ x: xBand, y: yLin, band: true, xTitle: "Release year", yTitle: `Number of movies • ${MEASURES[key]}`, yFormat: "~s" });

  const isPartial = d => stats.partial && d.year === d3.max(stats.years);
  const fill = d => {
    if (state.year !== null && d.year !== state.year) return MUTED_FILL;
    return isPartial(d) ? BLUE_LIGHT : BLUE;
  };
  const prev = d => counts.find(c => c.year === d.year - 1);

  const t = svg.transition().duration(DURATION);
  gBars.selectAll("rect.bar")
    .data(counts, d => d.year)
    .join(enter => enter.append("rect").attr("class", "bar").attr("rx", 3).attr("fill", BLUE)
                        .attr("y", height).attr("height", 0))
    .attr("x", d => xBand(d.year))
    .attr("width", xBand.bandwidth())
    .on("mouseenter", (event, d) => {
      const p = prev(d);
      const change = p ? ` • ${fmtSignedPct(d[state.measure] / p[state.measure] - 1)} vs. ${p.year}` : "";
      showTooltip(event, `<strong>${d.year}${isPartial(d) ? " (partial year)" : ""}</strong>
      <span class="meta">${fmtInt(d[state.measure])} ${MEASURES[state.measure].toLowerCase()}${change}</span>`);
      d3.select(event.currentTarget).attr("stroke", "#ffffff").attr("stroke-width", 1.5);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", event => { hideTooltip(); d3.select(event.currentTarget).attr("stroke", null); })
    .on("click", (event, d) => {
      state.year = state.year === d.year ? null : d.year; // click again to clear
      render(false);
    })
    .transition(t)
    .attr("y", d => yLin(d[key]))
    .attr("height", d => height - yLin(d[key]))
    .attr("fill", fill);

  // Value label above the selected bar (partial year note)
  const labels = [];
  if (state.year !== null) {
    const s = counts.find(d => d.year === state.year);
    if (s) labels.push({ id: "sel", year: s.year, y: yLin(s[key]) - 6, text: fmtInt(s[key]), cls: "bar-label" });
  }
  const last = counts[counts.length - 1];
  if (stats.partial && last && state.year !== last.year) {
    labels.push({ id: "partial", year: last.year, y: yLin(last[key]) - 6, text: "partial year", cls: "partial-label" });
  }
  gBars.selectAll("text")
    .data(labels, d => d.id)
    .join("text")
    .attr("class", d => d.cls)
    .attr("text-anchor", "middle")
    .attr("x", d => xBand(d.year) + xBand.bandwidth() / 2)
    .transition(t)
    .attr("y", d => d.y)
    .text(d => d.text);
}

// Data Story (one function per step)
// Edit these to tell your own story. The last line of each dot step sets the axes.
const STEPS = [
  // Step 0: One dot = one film
  () => {
    layoutGrid();
    films.forEach(d => { d.tfill = NEUTRAL; d.topacity = 0.9; });
    setAxes({});
  },
  // Step 1: Interactive bar chart (# of movies per year; dots hidden)
  () => {
    layoutYearStacks(); // put dots where step 2 needs them
    hideDots();
    drawYearBarChart();
  },
  // Step 2: Notable films stacked by year by studio tier
  () => {
    layoutYearStacks();
    films.forEach(d => { d.tfill = TIER_COLORS[d.tier]; d.topacity = 0.95; });
    setAxes({ x: xBand, band: true, xTitle: "Release year • one dot per notable film" });
  },
  // Step 3: Top 5% by votes highlighted
  () => {
    layoutYearStacks();
    films.forEach(d => {
      const top = d.votes >= stats.top5Threshold;
      d.tfill = top ? TIER_COLORS[d.tier] : NEUTRAL;
      d.topacity = top ? 1 : 0.18;
    });
    setAxes({ x: xBand, band: true, xTitle: "Release year" });
  },
  // Step 4: Runtime by year, with the median line
  () => {
    xBand.domain(stats.filmYears).range([0, width]);
    yLin.domain([40, d3.max(films, d => d.runtime)]).nice().range([height, 0]);
    films.forEach(d => {
      d.tx = xBand(d.year) + xBand.bandwidth() * (0.5 + jitter(d) * 0.9);
      d.ty = yLin(d.runtime);
      d.tr = 2;
      d.tfill = TIER_COLORS[d.tier];
      d.topacity = 0.5;
    });
    setAxes({ x: xBand, y: yLin, band: true, xTitle: "Release year", yTitle: "Runtime (minutes)" });
    const med = stats.filmYears
      .filter(y => y <= stats.lastFullYear)
      .map(y => [xBand(y) + xBand.bandwidth() / 2, yLin(d3.median(films.filter(d => d.year === y), d => d.runtime))]);
    medianPath.raise().attr("d", d3.line()(med))
      .transition().delay(DURATION).duration(REDUCED_MOTION ? 0 : 400).attr("opacity", 1);
  },
  // Step 5: Runtime vs. rating (size = # of votes)
  () => scatterRuntimeRating(),
  // Step 6: Explore: same chart (filters ON)
  () => scatterRuntimeRating(),
];

function scatterRuntimeRating() {
  xLin.domain([40, d3.max(films, d => d.runtime)]).nice().range([0, width]);
  yLin.domain(d3.extent(films, d => d.rating)).nice().range([height, 0]);
  rVotes.domain([0, d3.max(films, d => d.votes)]).range([1.2, Math.max(6, width / 60)]);
  films.forEach(d => {
    d.tx = xLin(d.runtime);
    d.ty = yLin(d.rating);
    d.tr = rVotes(d.votes);
    d.tfill = TIER_COLORS[d.tier];
    d.topacity = 0.7;
  });
  setAxes({ x: xLin, y: yLin, xTitle: "Runtime (minutes)", yTitle: "IMDb rating" });
  gDots.selectAll("circle").sort((a, b) => d3.descending(a.votes, b.votes)); // smaller dots on top
}

// Render
function render(animate = true) {
  if (state.step !== 4) hideMedian();
  STEPS[state.step]();

  const onBars = state.step === BAR_STEP, exploring = state.step === EXPLORE_STEP;
  d3.select("#controls").classed("show-bars", onBars).classed("show-explore", exploring);
  d3.select("#legend").classed("interactive", exploring)
    .style("visibility", state.step >= 2 ? "visible" : "hidden");
  d3.select("#year-bars").style("visibility", exploring ? "visible" : "hidden");
  if (exploring) drawYearFilterBars();
  gBars.interrupt().transition().duration(onBars ? 300 : 200).attr("opacity", onBars ? 1 : 0);
  gBars.style("pointer-events", onBars ? "auto" : "none");

  films.forEach(d => {
    d.visible = !exploring || (!state.hiddenTiers.has(d.tier)
                               && (state.genre === "All" || d.genre === state.genre)
                               && (state.year === null || d.year === state.year));
  });

  const dots = gDots.selectAll("circle")
    .style("pointer-events", d => (d.visible && d.topacity > 0.3 ? "auto" : "none"));
  const target = animate ? dots.transition().duration(DURATION)
    .delay(d => (REDUCED_MOTION ? 0 : (d.tx / Math.max(1, width)) * 250)) // stagger left to right (Lab 4)
    : dots.interrupt();
  target
    .attr("cx", d => d.tx)
    .attr("cy", d => d.ty)
    .attr("r", d => d.tr)
    .attr("fill", d => d.tfill)
    .attr("opacity", d => (d.visible ? d.topacity : 0.05));
}

// Small clickable year bars in explorer
function drawYearFilterBars() {
  const node = document.querySelector("#year-bars");
  const w = node.getBoundingClientRect().width, h = 90, base = 68;
  const perYear = d3.rollups(films, v => v.length, d => d.year).sort((a, b) => a[0] - b[0]);
  const x = d3.scaleBand().domain(perYear.map(d => d[0])).range([margin.left, w - margin.right]).padding(0.15);
  const y = d3.scaleLinear().domain([0, d3.max(perYear, d => d[1])]).range([base, 6]);
  const sel = d3.select(node).attr("width", w).attr("height", h);

  sel.selectAll("rect")
    .data(perYear, d => d[0])
    .join("rect")
    .attr("x", d => x(d[0])).attr("width", x.bandwidth())
    .attr("y", d => y(d[1])).attr("height", d => base - y(d[1]))
    .attr("rx", 3)
    .attr("fill", d => (state.year === null || state.year === d[0] ? BLUE : MUTED_FILL))
    .style("cursor", "pointer")
    .on("click", (event, d) => { state.year = state.year === d[0] ? null : d[0]; render(false); })
    .selectAll("title").data(d => [d]).join("title")
    .text(d => `${d[0]}: ${fmtInt(d[1])} films shown (click to filter)`);

  sel.selectAll("g.year-axis").data([null]).join("g")
    .attr("class", "axis year-axis")
    .attr("transform", `translate(0,${base})`)
    .call(d3.axisBottom(x).tickFormat(shortYear).tickSizeOuter(0));
}

// Scroll and resize
function setupScroller() {
  const scroller = scrollama();
  scroller
    .setup({ step: ".step", offset: 0.55 })
    .onStepEnter(({ element, index }) => {
      d3.selectAll(".step").classed("is-active", (d, i) => i === index);
      state.step = +element.dataset.step;
      render(true);
    });
  window.addEventListener("resize", () => { resize(); scroller.resize(); });
}

function resize() {
  const box = document.querySelector("#chart").getBoundingClientRect();
  svg.attr("width", box.width).attr("height", box.height);
  width = Math.max(100, box.width - margin.left - margin.right);
  height = Math.max(100, box.height - margin.top - margin.bottom);
  plot.attr("transform", `translate(${margin.left},${margin.top})`);
  render(false);
}

// Tooltip
function showTooltip(event, html) {
  tooltip.html(html).style("opacity", 1);
  moveTooltip(event);
  if (event.currentTarget.tagName === "circle") {
    d3.select(event.currentTarget).style("stroke", "#ffffff").style("stroke-width", "1.5px");
  }
}
function moveTooltip(event) {
  const pad = 14, node = tooltip.node(), w = node.offsetWidth, h = node.offsetHeight;
  const x = event.clientX + pad + w > window.innerWidth ? event.clientX - pad - w : event.clientX + pad;
  const y = Math.max(8, Math.min(window.innerHeight - h - 8, event.clientY - h / 2));
  tooltip.style("left", `${x}px`).style("top", `${y}px`);
}
function hideTooltip(event) {
  tooltip.style("opacity", 0);
  if (event && event.currentTarget && event.currentTarget.tagName === "circle") {
    d3.select(event.currentTarget).style("stroke", null).style("stroke-width", null);
  }
}