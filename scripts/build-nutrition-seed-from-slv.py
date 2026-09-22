#!/usr/bin/env python3
"""Build scripts/nutrition-seed.json from Livsmedelsverket + recipe aliases.

Primary macros: SLV Livsmedelsdatabas (scripts/slv-raw.json).
Aliases: curated recipe language → SLV nummer, plus auto short-name aliases.
Manual rows (id ≥ 900000): specialty items SLV lacks (PB2, chili crisp, …).

Attribution: Livsmedelsverkets Livsmedelsdatabas
https://www.livsmedelsverket.se/om-oss/psidata/livsmedelsdatabasen
"""
from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SLV_RAW = ROOT / "scripts" / "slv-raw.json"
OLD_SEED = ROOT / "scripts" / "nutrition-seed.json"
OUT = ROOT / "scripts" / "nutrition-seed.json"

MANUAL_ID_START = 900000
USDA_ID_START = 910000

# Specialty / branded-ish items from USDA FoodData Central (secondary).
# Only when SLV has no reasonable generic substitute. Do not alter SLV macros.
# Attribution: USDA FoodData Central (fdcId in external_id).
USDA_FOODS = [
    {
        "canonical_name": "chili crisp",
        "aliases": ["chili crunch", "kelp chili crisp", "chili olja", "chili oil"],
        "kcal_per_100g": 458,
        "protein_per_100g": 4.2,
        "fat_per_100g": 42,
        "carbs_per_100g": 18,
        "piece_weight_g": None,
        "density_g_per_ml": 0.95,
        "category": "usda",
        "needs_review": 1,
        "source": "usda",
        "external_id": "branded-chili-crisp-approx",
        "note": "Generic chili crisp / chili oil; no good SLV row",
    },
    {
        "canonical_name": "pb2",
        "aliases": ["pb2 pulver", "pulveriserat jordnötssmör"],
        "kcal_per_100g": 221,
        "protein_per_100g": 48,
        "fat_per_100g": 6,
        "carbs_per_100g": 18,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "usda",
        "needs_review": 1,
        "source": "usda",
        "external_id": "pb2-label-approx",
        "note": "Powdered peanut butter; not in SLV",
    },
    {
        "canonical_name": "gochujang",
        "aliases": ["gochujangpasta"],
        "kcal_per_100g": 267,
        "protein_per_100g": 3.3,
        "fat_per_100g": 5.0,
        "carbs_per_100g": 53.3,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "2244609",
    },
    {
        "canonical_name": "edamame",
        "aliases": ["fryst edamame", "edamame blancherad"],
        "kcal_per_100g": 121,
        "protein_per_100g": 11.9,
        "fat_per_100g": 5.2,
        "carbs_per_100g": 8.9,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "sr-edamame-approx",
        "note": "Shelled edamame; SLV lacks green soybeans",
    },
    {
        "canonical_name": "lönnsirap",
        "aliases": ["maple syrup", "lönnsirap honung"],
        "kcal_per_100g": 260,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 67,
        "piece_weight_g": None,
        "density_g_per_ml": 1.32,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "sr-maple-syrup",
        "note": "SLV has only light syrup; maple is USDA",
    },
    {
        "canonical_name": "coconut aminos",
        "aliases": [],
        "kcal_per_100g": 100,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 26.7,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "2412517",
    },
    {
        "canonical_name": "fisksås",
        "aliases": ["fish sauce"],
        "kcal_per_100g": 35,
        "protein_per_100g": 5.06,
        "fat_per_100g": 0.01,
        "carbs_per_100g": 3.64,
        "piece_weight_g": None,
        "density_g_per_ml": 1.2,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "2706457",
    },
    {
        "canonical_name": "risvinäger",
        "aliases": ["risvinsvinäger", "osötad risvinäger", "rice vinegar", "risvinäger"],
        "kcal_per_100g": 0,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 0,
        "piece_weight_g": None,
        "density_g_per_ml": 1.0,
        "category": "usda",
        "needs_review": 0,
        "source": "usda",
        "external_id": "2083928",
    },
    {
        "canonical_name": "mirin",
        "aliases": [],
        "kcal_per_100g": 241,
        "protein_per_100g": 0.3,
        "fat_per_100g": 0,
        "carbs_per_100g": 48,
        "piece_weight_g": None,
        "density_g_per_ml": 1.0,
        "category": "usda",
        "needs_review": 1,
        "source": "usda",
        "external_id": "mirin-approx",
    },
    {
        "canonical_name": "näringsjäst",
        "aliases": ["nutritional yeast"],
        "kcal_per_100g": 325,
        "protein_per_100g": 50,
        "fat_per_100g": 5,
        "carbs_per_100g": 35,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "usda",
        "needs_review": 1,
        "source": "usda",
        "external_id": "nutritional-yeast-approx",
    },
    {
        "canonical_name": "sesamolja",
        "aliases": ["rostad sesamolja", "toasted sesame oil"],
        "kcal_per_100g": 884,
        "protein_per_100g": 0,
        "fat_per_100g": 100,
        "carbs_per_100g": 0,
        "piece_weight_g": None,
        "density_g_per_ml": 0.91,
        "category": "slv-preferred",
        "needs_review": 0,
        "source": "slv",
        "external_id": "38",
        "note": "Prefer SLV Sesamolja #38 — listed here only if curated miss",
    },
]


# alias (lowercase, already recipe-normalized form) → SLV nummer
CURATED: dict[str, int] = {
    # fats / oils
    "olivolja": 35,
    "extra virgin olivolja": 4659,
    "olivolja extra jungfruolja": 4659,
    "sesamolja": 38,
    "rostad sesamolja": 38,
    "rapsolja": 2189,
    "solrosolja": 40,
    "avokadoolja": 35,  # proxy — no SLV avocado oil
    "matolja": 3418,
    "olja": 2189,
    "smör": 29,
    "lätt smör": 29,
    "stekspray": 49,  # dressing 0% as near-zero spray proxy — overridden by grams logic
    "olivoljespray": 49,
    # salt / pepper / spices → salt 0 kcal or chili; black pepper manual
    "salt": 1975,
    "flingsalt": 1975,
    "salt till pastavattnet": 1975,
    "salt och peppar": 1975,
    # dairy
    "keso": 70,
    "keso 4%": 70,
    "keso 1,5%": 70,
    "supermini keso": 70,
    "cottage cheese": 70,
    "kvarg": 3243,
    "grekisk yoghurt": 7146,
    "grekisk yoghurt 0%": 7146,
    "naturell grekisk yoghurt 0%": 7146,
    "tjock grekisk yoghurt": 7146,
    "grekisk yoghurt 2%": 6113,
    "gräddfil": 1713,
    "crème fraîche": 1719,
    "mini crème fraîche": 7139,
    "mellanmjölk": 150,
    "skummjölk": 118,
    "mjölk": 123,
    "parmesan": 103,
    "riven parmesan": 103,
    "riven parmesanost": 103,
    "pecorino": 103,  # proxy parmesan
    "pecorino eller parmesan": 103,
    "mozzarella": 2255,
    "riven mozzarella": 2255,
    "mager riven ost": 77,  # 10%
    "lättost 50% cheddar": 95,  # 17%
    "swiss-ost": 96,
    "leerdamer 50%": 96,
    "swiss-ost / leerdamer 50%": 96,
    "cotijaost": 103,
    "smulad cotija-ost": 103,
    "labneh": 75,
    # eggs
    "ägg": 1225,
    "ägg stora": 1225,
    "ägg stort": 1225,
    "äggvita": 1227,
    # meat / fish
    "kycklingfilé": 1173,
    "halloumi": 100,
    "grillad halloumi": 2899,
    "vit fiskfilé": 1246,
    "fiskfilé": 1246,
    "torskfilé": 1246,
    "torsk": 1246,
    "sojafärs": 6287,
    "tofu": 905,

    "kycklingbröst": 1173,
    "kycklingbröstfilé": 1173,
    "kycklinglår": 1174,
    "kyckling lår": 1174,
    "malet kycklingbröst": 1173,
    "kycklinglår utan skinn": 1174,
    "kycklingfärs": 1173,  # lean breast as mince proxy; see also manual override note
    "kycklingfärs mager": 1173,
    "nötfärs": 2492,  # blandfärs raw as proxy if no pure beef — check
    "extra mager nötfärs": 2492,
    "malet nötkött": 2492,
    "malet fläskkött": 2492,
    "hjortfärs": 5044,
    "bacon": 1003,
    "bacon förstekt": 1004,
    "tonfisk": 1278,
    "ventresca tonfisk": 1275,
    "ventresca tonfisk oljeinlagd": 1275,
    "ansjovis": 1265,
    "ansjovisfilé": 1265,
    "räkor": 1278,  # placeholder — find shrimp
    # produce
    "banan": 553,
    "mogna bananer": 553,
    "citron": 559,
    "citronskal": 602,
    "citronsaft": 645,
    "citron juice": 645,
    "citronzest": 602,
    "lime": 572,
    "limejuice": 652,
    "pressad lime": 652,
    "gurka": 339,
    "zucchini": 362,  # squash
    "squash": 362,
    "tomat": 364,
    "körsbärstomat": 4937,
    "tärnade körsbärstomater": 4937,
    "soltorkade tomater": 365,
        "tomatpuré": 410,
    "tomatpure": 410,
    "kycklingfilé": 1173,
    "halloumi": 100,
    "grillad halloumi": 2899,
    "vit fiskfilé": 1246,
    "fiskfilé": 1246,
    "torskfilé": 1246,
    "torsk": 1246,
    "sojafärs": 6287,
    "tofu": 905,

    "kycklingfile": 1173,
    "soltorkad tomat": 365,
    "soltorkade tomat": 365,
    "soltorkade tomater": 365,
    "sesamfrö": 1572,
    "sesamfrön": 1572,
    "rostat sesamfrö": 1572,
    "rostat sesamfrön": 1572,
    "parmesanost": 103,
    "mager ost": 77,
    "mager riven ost": 77,
    "mini crème fraîche": 7139,
    "mini creme fraiche": 7139,
    "crème fraîche": 1719,
    "creme fraiche": 1719,
    "fryst grönkål": 338,
    "grönkål": 337,
    "röd lök": 344,  # SLV saknar rödlök → Lök gul
    "neutral matolja": 3418,
    "lax": 1255,
    "räka": 1395,
    "räkor": 1395,
    "majskärnor": 400,

    "paprika": 351,  # Paprika röd (default)
    "röd paprika": 351,
    "grön paprika": 350,
    "rödlök": 344,  # proxy Lök gul
    "gul lök": 344,
    "lök": 344,
    "schalottenlök": 344,  # proxy Lök gul
    "salladslök": 378,  # Gräslök (SLV saknar salladslök)
    "vårlök": 378,
    "vitlök": 371,
    "vitlöksklyfta": 371,
    "vitlöksklyftor": 371,
    "avokado": 320,
    "spenat": 4941,
    "morot": 289,
    "palsternacka": 290,
    "champinjon": 333,
    "champinjoner": 333,
    "majs": 400,  # Majskorn konserv. u. lag
    "konserverad majs": 400,
    "selleri": 321,
    "selleristjälkar": 321,
    "stjälkselleri": 321,
    "ruccola": 2561,
    "sallad": 340,  # Isbergssallat — inte skaldjurssallad
    "persilja": 352,
    "bladpersilja": 352,
    "hackad bladpersilja": 352,
    "dill": 377,
    "koriander": 7193,
    "mynta": 7194,
    "basilika": 379,
    "färsk basilika": 379,
    "thaibasilika": 379,
    "färsk thaibasilika": 379,
    "ingefära": 2269,
    "färsk ingefära": 2269,
    "jalapeño": 380,
    "jalapeños": 380,
    "chilipeppar": 380,
    "pickles": 487,
    "skivade pickles": 487,
    "hela pickles": 487,
    # pantry / carbs
    "pasta": 845,
    "pasta okokt": 845,
    "spaghetti": 845,
    "lasagneplattor": 845,
    "ris": 2481,
    "kokt ris": 804,
    "kokt vitt ris": 804,
    "jasminris": 2477,
    "basmatiris": 2475,
    "okokat klibbigt ris": 2477,
    "kokt kortkornat ris": 6782,
    "vetemjöl": 1941,
    "vetemjöl special": 1941,
    "mjöl": 1941,
    "självjäsande mjöl": 1941,
    "vetegluten": 1941,
    "mandelmjöl": 6087,
    "majsstärkelse": 1945,
    "socker": 1892,
    "strösocker": 1892,
    "farinsocker": 1892,
    "honung": 1896,
    # lönnsirap → USDA maple (SLV only has light syrup)
    "bakpulver": 1981,
    "bikarbonat": 1981,
    "kanel": 2306,
    "sesamfrön": 1572,
    "rostat sesamfrön": 1572,
    "jordnötter": 1561,
    "hackade jordnötter": 1561,
    "panko": 202,  # bread crumbs proxy
    "panko-ströbröd": 202,
    "brödsmul": 202,
    "grovt brödsmul": 202,
    "bröd": 202,
    # sauces / asian
    "soja": 909,
    "sojasås": 909,
    "tamari": 909,
    "mörk soja": 910,
    "thaisoja": 909,
    "ostronsås": 909,  # no SLV oyster sauce; soy-adjacent proxy
    # fisksås / risvinäger → USDA secondary (not soy proxy)
    "balsamicovinäger": 1966,  # Vinäger ättiksyra — closest SLV; no balsamico row
    "chilisås": 1968,
    "sriracha": 1968,
    "sweet chilisås": 2007,
    "ketchup": 1969,
    "majonnäs": 50,
    "lätt majonnäs": 53,
    "tomatsås": 461,
    "stark pizzasås": 5726,
    "pizzasås": 5726,
    "kycklingbuljong": 1224,
    "hönsbuljong": 1224,
    "grönsaksbuljong": 545,
    "vit misopasta": 908,
    "miso": 908,
    # other
    "vatten": 1953,  # Vatten kranvatten 0 kcal
    "espresso": 1958,
    "kakao": 1886,
    "mörk choklad": 6907,
    "mörk choklad 70%": 6907,
    "hackad mörk choklad": 6907,
    "chocolate chips": 6907,
    # vaniljextrakt: leave to MANUAL_FOODS (do not claim socker)
    "timjan": 352,  # SLV saknar timjan-ört → Persilja blad (örtrproxy)
    "färsk timjan": 352,
    "rosmarin": 352,
}

# Prefer better SLV ids when we discover them during build (filled below).
PREFERRED_SEARCH: dict[str, str] = {
    "rapsolja": r"^Rapsolja$",
    "matolja": r"^Matolja$",
    "mozzarella": r"^Ost mozzarella",
    "räkor": r"^Räka|^Räkor",
    "sesamfrön": r"^Sesamfrö",
    "gräddfil": r"^Gräddfil",
    "mellanmjölk": r"^Mellanmjölk|^Mjölk fett 1,5",
    "skummjölk": r"^Mjölk fett 0,5|^Lättmjölk",
    "paprika": r"^Paprika röd$",
    "röd paprika": r"^Paprika röd$",
    "grön paprika": r"^Paprika grön$",
    "rödlök": r"^Lök gul$",
    "gul lök": r"^Lök gul$",
    "lök": r"^Lök gul$",
    "schalottenlök": r"^Lök gul$",
    "salladslök": r"^Gräslök$",
    "vårlök": r"^Gräslök$",
    "grönkål": r"^Grönkål$",
    "spenat": r"^Spenat färsk$|^Spenat",
    "ruccola": r"^Ruccola",
    "sallad": r"^Isbergssallat|^Huvudsallad",
    "koriander": r"^Koriander",
    "mynta": r"^Grönmynta|^Mynta$",
    "dill": r"^Dill färsk$",
    "basilika": r"^Basilika färsk$|^Basilika",
    "ingefära": r"^Ingefära färsk$|^Ingefära",
    "majs": r"^Majskorn konserv",
    "majskärnor": r"^Majskorn konserv",
    "konserverad majs": r"^Majskorn konserv",
    "majsstärkelse": r"Majsstärkelse|Maizena",
    "mandelmjöl": r"^Mandelmjöl$",
    "kakao": r"^Kakaopulver",
    "mörk choklad": r"^Mörk choklad kakao 70%",
    "fisksås": r"Fisksås",
    "balsamicovinäger": r"^Vinäger",
    "ketchup": r"^Ketchup$",
    "nötfärs": r"^Nöt färs|^Nötfärs",
    "malet fläskkött": r"^Gris färs|^Fläskfärs",
    "labneh": r"labneh|yoghurt.*Turk",
    "potatisgnocchi": r"gnocchi|Gnocchi",
    "risnudlar": r"Risnudlar|risnudlar|Glasnudlar",
    "wontonskal": r"wonton|Wonton",
    "näringsjäst": r"näringsjäst|Näringsjäst",
    "espresso": r"^Kaffe espresso",
    "vatten": r"^Vatten kranvatten$",
    "morot": r"^Morot$",
    "äggvita": r"^Äggvita rå$",
}


MANUAL_FOODS = [
    {
        "canonical_name": "svartpeppar",
        "aliases": [
            "peppar",
            "pepper",
            "vitpeppar",
            "msg",
            "krydda",
            "paprikapulver",
            "rökt paprika",
            "kummin",
            "spiskummin",
            "cayenne",
            "cayennepeppar",
            "oregano",
            "kanel",  # also SLV — alias may collide; curated prefers SLV kanel
            "gurkmeja",
            "kardemumma",
            "vitlökspulver",
            "lökpulver",
            "chilipulver",
            "milt chilipulver",
            "chiliflakes",
            "chiliflingor",
            "peperoncino",
            "torkad chili",
            "smulad torkad chili",
            "gochugaru",
            "persiljeflakes",
            "tajn",
            "tajín",
            "italiensk kryddmix",
            "italiensk örtkrydda",
            "sichuanpepparkorn",
            "torkad dill",
            "vitlökspasta",
            "brunt stevia",
            "sötningsmedel",
            "monk fruit",
            "monk fruit-sötning",
        ],
        "kcal_per_100g": 0,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 0,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "krydda",
        "needs_review": 0,
        "source": "manual",
    },
    {
        "canonical_name": "pb2",
        "aliases": ["pb2 pulver", "pulveriserat jordnötssmör", "pulveriserat jordnötssmör pb2"],
        "kcal_per_100g": 221,
        "protein_per_100g": 48,
        "fat_per_100g": 6,
        "carbs_per_100g": 18,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "chili crisp",
        "aliases": ["chili crunch", "kelp chili crisp", "chili olja"],
        "kcal_per_100g": 500,
        "protein_per_100g": 5,
        "fat_per_100g": 45,
        "carbs_per_100g": 20,
        "piece_weight_g": None,
        "density_g_per_ml": 0.95,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "gochujang",
        "aliases": ["gochujangpasta"],
        "kcal_per_100g": 220,
        "protein_per_100g": 5,
        "fat_per_100g": 3,
        "carbs_per_100g": 45,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "edamame",
        "aliases": ["fryst edamame", "edamame blancherad"],
        "kcal_per_100g": 122,
        "protein_per_100g": 11,
        "fat_per_100g": 5,
        "carbs_per_100g": 9,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "vatten",
        "aliases": ["pocheringsvätska", "pickling lake"],
        "kcal_per_100g": 0,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 0,
        "piece_weight_g": None,
        "density_g_per_ml": 1.0,
        "category": "dryck",
        "needs_review": 0,
        "source": "manual",
    },
    {
        "canonical_name": "vaniljextrakt",
        "aliases": ["vanilj", "vanilla extract"],
        "kcal_per_100g": 288,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 13,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "proteinpulver",
        "aliases": ["vaniljproteinpulver"],
        "kcal_per_100g": 370,
        "protein_per_100g": 80,
        "fat_per_100g": 3,
        "carbs_per_100g": 5,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "coconut aminos",
        "aliases": [],
        "kcal_per_100g": 60,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 14,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "ume-pickle",
        "aliases": ["umeboshi-juice", "ume pickle"],
        "kcal_per_100g": 20,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 4,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "buffalosås",
        "aliases": ["extra buffalosås"],
        "kcal_per_100g": 50,
        "protein_per_100g": 0,
        "fat_per_100g": 3,
        "carbs_per_100g": 5,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "rispapper",
        "aliases": [],
        "kcal_per_100g": 330,
        "protein_per_100g": 1,
        "fat_per_100g": 0,
        "carbs_per_100g": 80,
        "piece_weight_g": 10,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "gyozaskal",
        "aliases": ["wontonskal"],
        "kcal_per_100g": 290,
        "protein_per_100g": 8,
        "fat_per_100g": 2,
        "carbs_per_100g": 58,
        "piece_weight_g": 8,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "mirin",
        "aliases": [],
        "kcal_per_100g": 230,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 45,
        "piece_weight_g": None,
        "density_g_per_ml": 1.0,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "kinesisk svart vinäger",
        "aliases": ["chinkiang", "kinesisk svart vinäger chinkiang"],
        "kcal_per_100g": 30,
        "protein_per_100g": 0,
        "fat_per_100g": 0,
        "carbs_per_100g": 5,
        "piece_weight_g": None,
        "density_g_per_ml": 1.0,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "näringsjäst",
        "aliases": [],
        "kcal_per_100g": 325,
        "protein_per_100g": 50,
        "fat_per_100g": 5,
        "carbs_per_100g": 35,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "torrjäst",
        "aliases": [],
        "kcal_per_100g": 325,
        "protein_per_100g": 40,
        "fat_per_100g": 5,
        "carbs_per_100g": 40,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "vallmofrön",
        "aliases": [],
        "kcal_per_100g": 525,
        "protein_per_100g": 18,
        "fat_per_100g": 42,
        "carbs_per_100g": 28,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "libanesiskt tunnbröd",
        "aliases": ["libanesiska tunnbröd", "wrap"],
        "kcal_per_100g": 275,
        "protein_per_100g": 9,
        "fat_per_100g": 4,
        "carbs_per_100g": 52,
        "piece_weight_g": 70,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "brioche hamburgerbröd",
        "aliases": ["brioche hamburgerbröd mini"],
        "kcal_per_100g": 320,
        "protein_per_100g": 9,
        "fat_per_100g": 8,
        "carbs_per_100g": 52,
        "piece_weight_g": 40,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "frysta dumplings",
        "aliases": [],
        "kcal_per_100g": 200,
        "protein_per_100g": 8,
        "fat_per_100g": 7,
        "carbs_per_100g": 26,
        "piece_weight_g": 20,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "blåmögelostdressing",
        "aliases": ["ranch", "blåmögelostdressing eller ranch"],
        "kcal_per_100g": 350,
        "protein_per_100g": 2,
        "fat_per_100g": 35,
        "carbs_per_100g": 5,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "bananpeppar",
        "aliases": ["bananpeppar picklade"],
        "kcal_per_100g": 30,
        "protein_per_100g": 1,
        "fat_per_100g": 0,
        "carbs_per_100g": 6,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
    {
        "canonical_name": "potatisgnocchi",
        "aliases": [],
        "kcal_per_100g": 160,
        "protein_per_100g": 4,
        "fat_per_100g": 1,
        "carbs_per_100g": 33,
        "piece_weight_g": None,
        "density_g_per_ml": None,
        "category": "special",
        "needs_review": 1,
        "source": "manual",
    },
]


def norm(s: str) -> str:
    s = str(s or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


def fold(s: str) -> str:
    """ASCII-ish fold for secondary alias keys (filé → file)."""
    s = norm(s)
    return (
        s.replace("é", "e")
        .replace("è", "e")
        .replace("ê", "e")
        .replace("á", "a")
        .replace("à", "a")
        .replace("â", "a")
        .replace("î", "i")
        .replace("ï", "i")
        .replace("ô", "o")
        .replace("û", "u")
        .replace("ü", "u")
        .replace("ç", "c")
    )


def find_by_regex(foods: list[dict], pattern: str) -> dict | None:
    rx = re.compile(pattern, re.I)
    hits = [f for f in foods if rx.search(f["namn"] or "")]
    if not hits:
        return None
    hits.sort(key=lambda f: (len(f["namn"]), f["nummer"]))
    return hits[0]


def is_simple_name(namn: str) -> bool:
    n = namn.strip()
    if " m." in n.lower() or " typ " in n.lower():
        return False
    if re.search(r"fett\s+\d", n, re.I):
        return False
    words = n.split()
    return 1 <= len(words) <= 3 and len(n) <= 28


def main() -> None:
    if not SLV_RAW.exists():
        raise SystemExit(f"Missing {SLV_RAW} — run scripts/fetch-slv-catalog.py first")

    raw = json.loads(SLV_RAW.read_text())
    foods = raw["foods"]
    by_nummer = {f["nummer"]: f for f in foods}

    # Improve curated via preferred regex searches
    curated = dict(CURATED)
    for alias, pattern in PREFERRED_SEARCH.items():
        hit = find_by_regex(foods, pattern)
        if hit:
            curated[alias] = hit["nummer"]

    # Fix rapsolja if found
    hit = find_by_regex(foods, r"^Rapsolja")
    if hit:
        curated["rapsolja"] = hit["nummer"]
        curated["matolja"] = hit["nummer"]
        curated["olja"] = hit["nummer"]

    ingredients: list[dict] = []
    alias_owner: dict[str, int] = {}
    by_id: dict[int, dict] = {}

    def claim_alias(alias: str, iid: int, force: bool = False) -> bool:
        a = norm(alias)
        if not a:
            return False
        claimed = False
        for key in {a, fold(a)}:
            if key in alias_owner and not force:
                continue
            prev = alias_owner.get(key)
            if prev is not None and prev != iid and force:
                prev_row = by_id.get(prev)
                if prev_row:
                    prev_row["aliases"] = [x for x in prev_row["aliases"] if norm(x) != key and fold(x) != key]
            alias_owner[key] = iid
            claimed = True
        return claimed

    # 1) SLV foods
    for f in foods:
        namn = (f["namn"] or "").strip()
        if not namn:
            continue
        iid = int(f["nummer"])
        # unique canonical: SLV names should be unique; if clash append nummer
        canon = namn
        row = {
            "id": iid,
            "canonical_name": canon,
            "category": f.get("typ"),
            "kcal_per_100g": float(f["kcal_per_100g"] or 0),
            "protein_per_100g": float(f["protein_per_100g"] or 0),
            "fat_per_100g": float(f["fat_per_100g"] or 0),
            "carbs_per_100g": float(f["carbs_per_100g"] or 0),
            "piece_weight_g": None,
            "density_g_per_ml": 0.91 if re.search(r"olja$", namn, re.I) else None,
            "needs_review": 0,
            "source": "slv",
            "external_id": str(iid),
            "aliases": [],
        }
        claim_alias(canon, iid)
        # short auto-alias for simple names + stripped raw cuts
        if is_simple_name(namn):
            short = norm(namn)
            if claim_alias(short, iid) and short != norm(canon):
                row["aliases"].append(short)
        # "Kyckling lår rå u. skinn" → kyckling lår, kycklinglår
        stripped = namn
        stripped = re.sub(r"\b[mu]\.\s*skinn\b", " ", stripped, flags=re.I)
        stripped = re.sub(
            r"\b(rå|kokt|stekt|ugnsstekt|grillad|frysvara|konserv\.?|avrunnen|berikad|eko\.?|med|utan|skinn|salt|hel|bitar?|mogen|mogna)\b",
            " ",
            stripped,
            flags=re.I,
        )
        stripped = re.sub(r"\b[mu]\.\b", " ", stripped, flags=re.I)
        stripped = re.sub(r"\s+", " ", stripped).strip(" ,.-")
        sn = norm(stripped)
        if sn and len(sn) >= 4 and len(sn) <= 40 and not re.search(r"\b(m|u)\b", sn):
            if claim_alias(sn, iid):
                row["aliases"].append(sn)
            compact = sn.replace(" ", "")
            if compact != sn and claim_alias(compact, iid):
                row["aliases"].append(compact)
        ingredients.append(row)
        by_id[iid] = row

    # 2) Curated aliases onto SLV rows (force — overrides auto short aliases)
    for alias, nummer in curated.items():
        if nummer not in by_id:
            print("WARN curated missing SLV", alias, nummer)
            continue
        a = norm(alias)
        if claim_alias(a, nummer, force=True):
            if a != norm(by_id[nummer]["canonical_name"]) and a not in by_id[nummer]["aliases"]:
                by_id[nummer]["aliases"].append(a)

    # 3) USDA secondary (only if alias not already claimed by SLV)
    uid = USDA_ID_START
    for g in USDA_FOODS:
        # Skip only if an existing SLV row already owns the canonical AND looks like the same food
        existing = alias_owner.get(norm(g["canonical_name"]))
        if existing is not None and existing < MANUAL_ID_START:
            owner_name = (by_id.get(existing) or {}).get("canonical_name") or ""
            # Weak false friends e.g. "Vinäger" owning "risvinäger" — allow USDA override
            if norm(g["canonical_name"]) in norm(owner_name) or fold(g["canonical_name"]) in fold(owner_name):
                continue
            # otherwise fall through and force-claim
        # Skip if marked slv-preferred and SLV id exists
        if g.get("source") == "slv" and g.get("external_id"):
            sid = int(g["external_id"])
            if sid in by_id:
                for a in [g["canonical_name"]] + list(g.get("aliases") or []):
                    if claim_alias(a, sid):
                        by_id[sid]["aliases"].append(norm(a))
                continue
        while uid in by_id:
            uid += 1
        row = {
            "id": uid,
            "canonical_name": g["canonical_name"],
            "category": g.get("category"),
            "kcal_per_100g": g["kcal_per_100g"],
            "protein_per_100g": g["protein_per_100g"],
            "fat_per_100g": g["fat_per_100g"],
            "carbs_per_100g": g["carbs_per_100g"],
            "piece_weight_g": g.get("piece_weight_g"),
            "density_g_per_ml": g.get("density_g_per_ml"),
            "needs_review": g.get("needs_review", 1),
            "source": "usda",
            "external_id": g.get("external_id"),
            "aliases": [],
        }
        claim_alias(g["canonical_name"], uid)
        for a in g.get("aliases") or []:
            if claim_alias(a, uid):
                row["aliases"].append(norm(a))
        ingredients.append(row)
        by_id[uid] = row
        uid += 1

    # 4) Manual specialty foods.
    # Force-claim only for rows that must override bad CURATED (vatten/vaniljextrakt).
    # Spice bucket (svartpeppar) stays non-forcing so SLV kanel/etc. win.
    FORCE_MANUAL = {"vaniljextrakt"}  # vatten fixed in CURATED → SLV kranvatten
    mid = MANUAL_ID_START
    for g in MANUAL_FOODS:
        force = norm(g["canonical_name"]) in FORCE_MANUAL
        if norm(g["canonical_name"]) in alias_owner and not force:
            owner = alias_owner[norm(g["canonical_name"])]
            for a in g.get("aliases") or []:
                if claim_alias(a, owner):
                    by_id[owner]["aliases"].append(norm(a))
            continue
        if norm(g["canonical_name"]) in alias_owner and force:
            # Steal canonical from wrong CURATED owner
            pass
        while mid in by_id:
            mid += 1
        row = {
            "id": mid,
            "canonical_name": g["canonical_name"],
            "category": g.get("category"),
            "kcal_per_100g": g["kcal_per_100g"],
            "protein_per_100g": g["protein_per_100g"],
            "fat_per_100g": g["fat_per_100g"],
            "carbs_per_100g": g["carbs_per_100g"],
            "piece_weight_g": g.get("piece_weight_g"),
            "density_g_per_ml": g.get("density_g_per_ml"),
            "needs_review": g.get("needs_review", 1),
            "source": g.get("source", "manual"),
            "external_id": None,
            "aliases": [],
        }
        claim_alias(g["canonical_name"], mid, force=force)
        for a in g.get("aliases") or []:
            if claim_alias(a, mid, force=force):
                row["aliases"].append(norm(a))
        ingredients.append(row)
        by_id[mid] = row
        mid += 1

    # 5) Piece weights from old seed where alias now points somewhere
    if OLD_SEED.exists():
        try:
            old = json.loads(OLD_SEED.read_text()).get("ingredients") or []
        except json.JSONDecodeError:
            old = []
        for o in old:
            pw = o.get("piece_weight_g")
            if not pw:
                continue
            keys = [norm(o["canonical_name"]), *[norm(a) for a in o.get("aliases") or []]]
            for k in keys:
                iid = alias_owner.get(k)
                if iid and by_id[iid]["piece_weight_g"] is None:
                    by_id[iid]["piece_weight_g"] = pw
                    break

    # Vitlöksklyfta piece weight + common produce (manual, verified-ish schablons)
    MANUAL_PIECE = {
        "vitlök": 3,
        "ägg": 58,
        "zucchini": 200,
        "squash": 200,
        "selleristjälkar": 40,
        "stjälkselleri": 40,
        "tomat": 100,
        "morot": 80,
        "paprika": 150,
        "röd paprika": 150,
        "grön paprika": 150,
        "gul lök": 110,
        "lök": 110,
        "rödlök": 110,
        "salladslök": 15,
        "vårlök": 15,
        "gräslök": 15,
        "banan": 120,
        "citron": 85,
        "lime": 60,
        "ingefära": 12,
        "lasagneplattor": 20,
        "champinjon": 20,
    }
    for alias, pw in MANUAL_PIECE.items():
        iid = alias_owner.get(norm(alias))
        if not iid:
            continue
        row = by_id[iid]
        if row.get("piece_weight_g") is None:
            row["piece_weight_g"] = pw
            row["piece_weight_source"] = "manual"

    # Vitlöksklyfta piece weight
    if "vitlök" in alias_owner:
        by_id[alias_owner["vitlök"]]["piece_weight_g"] = by_id[alias_owner["vitlök"]].get(
            "piece_weight_g"
        ) or 3
        by_id[alias_owner["vitlök"]]["piece_weight_source"] = by_id[alias_owner["vitlök"]].get(
            "piece_weight_source"
        ) or "manual"
    if "ägg" in alias_owner:
        by_id[alias_owner["ägg"]]["piece_weight_g"] = by_id[alias_owner["ägg"]].get(
            "piece_weight_g"
        ) or 58
        by_id[alias_owner["ägg"]]["piece_weight_source"] = by_id[alias_owner["ägg"]].get(
            "piece_weight_source"
        ) or "manual"
    if "zucchini" in alias_owner or "squash" in alias_owner:
        zid = alias_owner.get("zucchini") or alias_owner.get("squash")
        if zid:
            by_id[zid]["piece_weight_g"] = by_id[zid].get("piece_weight_g") or 200
            by_id[zid]["piece_weight_source"] = by_id[zid].get("piece_weight_source") or "manual"
    if "selleristjälkar" in alias_owner or "stjälkselleri" in alias_owner:
        sid = alias_owner.get("selleristjälkar") or alias_owner.get("stjälkselleri")
        if sid:
            by_id[sid]["piece_weight_g"] = by_id[sid].get("piece_weight_g") or 40
            by_id[sid]["piece_weight_source"] = by_id[sid].get("piece_weight_source") or "manual"

    # Ensure canonical uniqueness for D1 unique index — disambiguate collisions
    seen_canon: dict[str, int] = {}
    for row in ingredients:
        key = row["canonical_name"]
        if key in seen_canon:
            row["canonical_name"] = f"{key} ({row['id']})"
        seen_canon[row["canonical_name"]] = row["id"]

    payload = {
        "meta": {
            "source": "Livsmedelsverket Livsmedelsdatabas",
            "source_url": raw.get("source_url"),
            "attribution": "Livsmedelsverkets Livsmedelsdatabas",
            "slv_fetched_at": raw.get("fetched_at"),
            "slv_count": raw.get("count"),
            "manual_count": sum(1 for r in ingredients if r.get("source") == "manual"),
            "usda_count": sum(1 for r in ingredients if r.get("source") == "usda"),
            "note": "Macros from SLV where source=slv; aliases are app-specific. Do not alter SLV macro values.",
        },
        "ingredients": ingredients,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(
        f"Wrote {OUT}: {len(ingredients)} ingredients, "
        f"{len(alias_owner)} aliases, "
        f"manual={payload['meta']['manual_count']}"
    )


if __name__ == "__main__":
    main()
