/* =============================================================================
   config.js: the file to edit first.
   - Site wording (titles, intros, notes) lives here.
   - Each tab ("lens") has `ready`. Set it to true once its data is exported
     and the tab will switch from "Data coming soon" to a live map.
   Colors match the R notebook so the website and the PNG/HTML exports agree.
   ============================================================================= */

const CONFIG = {
  siteTitle: "Whose Children, Whose School?",
  siteSubtitle: "Governing K-12 Education in Texas, 2025–26",
  dataDir: "data/",
  testimonyDir: "testimonies/",
  mapCenter: [31.2, -99.3],
  mapZoom: 6,

  regions: ["City", "Suburb", "Town", "Rural"],
  majorities: ["Majority Hispanic", "Majority Black", "Majority White", "Mixed"],

  // Same hex values as nces_colors / group_colors in the Rmd
  regionColors: {
    City: "#D55E00", Suburb: "#0072B2", Town: "#E3C500", Rural: "#009E73", Unknown: "#BDBDBD",
  },
  majorityColors: {
    "Majority Hispanic": "#E69F00", "Majority Black": "#56B4E9",
    "Majority White": "#009E73", Mixed: "#B8B8B8", Unknown: "#9E9E9E",
  },

  /* The tabs, in order. `intro` receives summary.json (S) and number
     formatters (f), so figures update whenever you rerun the R export. */
  lenses: {
    complaints: {
      ready: true,
      label: "Parent complaints",
      short: "Complaints",
      metric: "rate",
      metricLabel: "Complaints per 10,000 students",
      ramp: ["#EFEAF6", "#CBBDE2", "#9C84C6", "#6E4FA6", "#46297A"],
      title: "Where parents complained, and about what",
      intro: (S, f) => `
        <p>From ${S.period_label.replace(" - ", " to ")}, Texas parents filed
        <strong>${f.n(S.totals.complaints_all)}</strong> complaints with the state.
        ${f.n(S.totals.zero_districts)} of ${f.n(S.totals.districts)} districts received no parent complaints.</p>`,
    },
    bans: {
      ready: false,
      label: "Book bans",
      short: "Bans",
      metric: "bans",
      metricLabel: "Books banned",
      ramp: ["#F6EAD8", "#E8C189", "#D29044", "#A45E1E", "#683610"],
      title: "Book bans and the year in complaints",
      soon: "This view will show where districts removed books, and how parent complaints moved over the year in districts with and without bans.",
    },
    choice: {
      ready: false,
      label: "School choice",
      short: "Choice",
      metric: "choice_near",
      metricLabel: "Schools of choice nearby",
      ramp: ["#E1F0EE", "#A6D6CF", "#5BB1A6", "#287F74", "#0E4D46"],
      title: "How close school choice sits",
      points: "choice_schools.geojson",   // optional dots drawn on this tab
      soon: "This view will show how many voucher-eligible schools sit inside or near each district.",
    },
    closures: {
      ready: false,
      label: "Closures",
      short: "Closures",
      metric: "closures",
      metricLabel: "Campuses closed",
      ramp: ["#E4E9F1", "#B2C1D9", "#7D95BD", "#4A6599", "#253D6A"],
      title: "Schools that closed in 2025–26",
      points: "closures.geojson",
      soon: "This view will show which communities lost public school campuses this school year.",
    },
    litigation: {
      ready: false,
      label: "Parent litigation",
      short: "Lawsuits",
      metric: "litigation",
      metricLabel: "Curriculum lawsuits",
      ramp: ["#F7E4E6", "#EBB3BA", "#D97786", "#B5475B", "#7A2238"],
      title: "Parent litigation against K-12 curriculum",
      soon: "This view will show where parents have sued school districts over what K-12 schools teach.",
    },
  },

  notes: `Complaints are those filed with the Texas Education Agency and released through
    public information requests. Rates use estimated 2025–26 enrollment. Districts under
    the minimum enrollment are drawn in gray and left out of rates, outliers and totals.
    Outliers compare each district's complaint count with what the statewide rate predicts
    for its enrollment (Poisson test, Benjamini–Hochberg adjusted).`,

  credit: `This prototype was created with the assistance of Claude, and its approach is inspired by
    EdBuild's <a href="http://viz.edbuild.org/maps/2016/fault-lines/"><i>Fault Lines</i></a>.`,
};

const SOON = "Coming soon";
// Placeholder shown in tables for tabs that aren't ready: a blurred number behind the label
const soonCellHTML = `<span class="soon-cell"><i aria-hidden="true">00.0</i><b>${SOON}</b></span>`;
