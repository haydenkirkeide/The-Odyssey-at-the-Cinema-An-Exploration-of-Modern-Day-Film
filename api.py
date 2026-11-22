import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Settings
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "data" / "TMDB_2016plus.csv"
OUT = Path(__file__).resolve().parent / "data"
START = pd.Timestamp("2016-01-01")
TODAY = pd.Timestamp.today().normalize()
NOTABLE_MIN_IMDB_VOTES = 1_000
FEATURE_MIN_RUNTIME = 40
MAX_FILMS = 2_500 # dots on the page = most-voted notable films
LIST_SEP = ", "

STUDIO_TIERS = {
    "Major studio": [r"walt disney pictures", r"walt disney animation", r"marvel studios", r"lucasfilm", r"pixar",
        r"20th century (?:studios|fox)", r"twentieth century fox", r"warner bros\.? (?:pictures|animation)",
        r"new line cinema", r"dc (?:films|studios|entertainment)", r"universal pictures", r"illumination",
        r"dreamworks animation", r"paramount pictures", r"paramount animation", r"nickelodeon movies",
        r"columbia pictures", r"sony pictures animation", r"screen gems", r"tristar pictures"],
    "Studio specialty arm": [r"focus features", r"searchlight pictures", r"sony pictures classics", r"warner independent"],
    "Mini-major": [r"lionsgate", r"lions gate", r"summit entertainment", r"metro-goldwyn-mayer", r"\bmgm\b", r"\bstx"],
    "Streamer": [r"netflix", r"amazon (?:studios|mgm studios)", r"apple (?:studios|original films)"],
}
NEEDED = ["id", "title", "release_date", "status", "runtime", "imdb_rating", "imdb_votes",
          "genres", "production_companies"]


def write_lines(path, records):
    """A JSON array with one record per line: readable, and diffs nicely in Git."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in records) + "\n]\n")


def main():
    if not SRC.exists():
        sys.exit(f"Can't find {SRC.resolve()}. Pass the path: python prepare_data.py /path/to/TMDB_2016plus.csv")
    OUT.mkdir(exist_ok=True)

    # Load ONLY columns the site needs (keeps memory low) ----
    df = pd.read_csv(SRC, usecols=lambda c: c in NEEDED, dtype=str, on_bad_lines="warn")
    missing = set(NEEDED) - set(df.columns)
    if missing:
        sys.exit(f"{SRC.name} is missing columns: {sorted(missing)}")
    rows_in_file = len(df)

    # Types and cleaning
    df["id"] = pd.to_numeric(df["id"], errors="coerce")
    df["release_date"] = pd.to_datetime(df["release_date"], errors="coerce", format="ISO8601")
    for c in ["runtime", "imdb_rating", "imdb_votes"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["id"]).drop_duplicates("id")
    df = df[(df["release_date"] >= START) & (df["release_date"] <= TODAY) & (df["status"] == "Released")].copy()
    df.loc[(df["runtime"] <= 0) | (df["runtime"] > 245), "runtime"] = np.nan
    df.loc[df["imdb_votes"].fillna(0) == 0, ["imdb_rating", "imdb_votes"]] = np.nan

    df["year"] = df["release_date"].dt.year
    df["is_feature"] = df["runtime"] >= FEATURE_MIN_RUNTIME
    df["notable"] = (df["imdb_votes"] >= NOTABLE_MIN_IMDB_VOTES) & df["is_feature"]
    df["genre"] = df["genres"].str.split(LIST_SEP).str[0].str.strip().fillna("Unknown")

    pc = df["production_companies"].str.lower()
    df["tier"] = np.where(pc.isna(), "Unknown (no companies listed)", "Independent/other")
    assigned = pd.Series(False, index=df.index)
    for tier, pats in STUDIO_TIERS.items():
        hit = pc.str.contains("|".join(pats), regex=True, na=False) & ~assigned
        df.loc[hit, "tier"] = tier
        assigned |= hit

    # # of movies per year (for the bar chart)
    counts = (df.groupby("year")
                .agg(all=("id", "size"), feature=("is_feature", "sum"), notable=("notable", "sum"))
                .reset_index()
                .astype(int))
    write_lines(OUT / "year_counts.json", counts.to_dict(orient="records"))

    # Notable films (dot charts)
    nb = df[df["notable"] & df["imdb_rating"].notna()]
    shown = nb.nlargest(MAX_FILMS, "imdb_votes") if MAX_FILMS else nb
    films = (shown[["id", "title", "year", "runtime", "imdb_rating", "imdb_votes", "genre", "tier"]]
               .rename(columns={"imdb_rating": "rating", "imdb_votes": "votes"})
               .assign(id=lambda d: d["id"].astype(int),
                       runtime=lambda d: d["runtime"].round().astype(int),
                       rating=lambda d: d["rating"].round(1),
                       votes=lambda d: d["votes"].astype(int),
                       title=lambda d: d["title"].fillna("Untitled"))
               .sort_values(["year", "id"]))
    write_lines(OUT / "films.json", films.to_dict(orient="records"))

    # #s quoted by page
    meta = {
        "source_file": SRC.name,
        "generated": TODAY.date().isoformat(),
        "rows_in_file": int(rows_in_file),
        "released_2016_plus": int(len(df)),
        "notable_total": int(len(nb)),
        "films_shown": int(len(films)),
        "max_films": MAX_FILMS,
        "notable_min_imdb_votes": NOTABLE_MIN_IMDB_VOTES,
        "latest_release": df["release_date"].max().date().isoformat(),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))

    sizes = ", ".join(f"{p.name} {p.stat().st_size / 1e6:.2f} MB" for p in sorted(OUT.glob("*.json")))
    print(f"Read {rows_in_file:,} rows -> {len(df):,} released 2016+ titles, {len(nb):,} notable, "
          f"{len(films):,} shown on the page.\nWrote {sizes}")


if __name__ == "__main__":
    main()
