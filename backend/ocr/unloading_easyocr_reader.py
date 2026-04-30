# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import time
from pathlib import Path
from collections import Counter

os.environ["PYTHONIOENCODING"] = "utf-8"

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import cv2
import easyocr
import numpy as np

from unloading_layout_reader import extract_fields_by_labels


DEFAULT_TEMPLATE_NAME = "unloading-template"
CANONICAL_RECEIVER = "\u0645\u0639\u0645\u0644 \u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0641\u0637 \u0627\u0644\u0630\u0647\u0628\u064a \u0644\u0625\u0646\u062a\u0627\u062c \u0627\u0644\u0627\u0633\u0641\u0644\u062a \u0627\u0644\u0645\u0624\u0643\u0633\u062f"
KNOWN_WAREHOUSES = [
    "\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u0646\u062c\u0641 \u0627\u0644\u062c\u062f\u064a\u062f",
    "\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u062f\u0648\u0631\u0629 \u0627\u0644\u062c\u062f\u064a\u062f",
    "\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u0634\u0639\u064a\u0628\u0629",
    "\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u0634\u0639\u0628\u064a\u0629",
    "\u0645\u0633\u062a\u0648\u062f\u0639 \u0648\u0627\u062d\u062f \u062d\u0632\u064a\u0631\u0627\u0646",
    "\u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629",
    "\u0645\u0635\u0641\u0649 \u0627\u0644\u0633\u0645\u0627\u0648\u0629",
]

MODEL_DIR = str(Path(__file__).resolve().parent.parent / "easyocr_models")
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

READER = easyocr.Reader(
    ["ar", "en"],
    gpu=False,
    verbose=False,
    model_storage_directory=MODEL_DIR,
)

TARGET_MIN_WIDTH = int(os.environ.get("UNLOADING_OCR_TARGET_MIN_WIDTH", "800"))
CROP_UPSCALE_LIMIT = float(os.environ.get("UNLOADING_OCR_CROP_UPSCALE_LIMIT", "1.45"))

OCR_CACHE = {}
FAST_MODE = os.environ.get("UNLOADING_OCR_FAST_MODE", "1") != "0"


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if hasattr(value, "item") and callable(getattr(value, "item")):
        try:
            return value.item()
        except Exception:
            return str(value)
    return value


def now_ms():
    return int(time.time() * 1000)


def to_western_digits(value=""):
    return str(value).translate(str.maketrans("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669", "0123456789"))


def clean_value(value=""):
    return (
        str(value)
        .replace("\u200f", "")
        .replace("\u200e", "")
        .replace("\n", " ")
        .replace("\r", " ")
        .replace("|", " ")
        .strip()
    )


def normalize_arabic(text=""):
    return (
        to_western_digits(str(text))
        .replace("ط¥", "ط§")
        .replace("ط£", "ط§")
        .replace("ط¢", "ط§")
        .replace("ظ‰", "ظٹ")
        .replace("ط¤", "ظˆ")
        .replace("ط¦", "ظٹ")
        .replace("ط©", "ظ‡")
        .replace("ظ€", "")
    )


def arabic_letters_only(text=""):
    return re.sub(r"[^\u0621-\u064A\s]", " ", normalize_arabic(text))


def levenshtein(a="", b=""):
    s = list(str(a))
    t = list(str(b))
    if not s:
        return len(t)
    if not t:
        return len(s)
    dp = [[0] * (len(t) + 1) for _ in range(len(s) + 1)]
    for i in range(len(s) + 1):
        dp[i][0] = i
    for j in range(len(t) + 1):
        dp[0][j] = j
    for i in range(1, len(s) + 1):
        for j in range(1, len(t) + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            )
    return dp[-1][-1]


def best_known_warehouse_match(value=""):
    key = re.sub(r"\s+", " ", arabic_letters_only(value)).strip()
    compact = key.replace(" ", "")
    if not compact:
        return ""

    best = ""
    best_score = 10 ** 9
    for choice in KNOWN_WAREHOUSES:
        c = re.sub(r"\s+", " ", arabic_letters_only(choice)).strip()
        c_compact = c.replace(" ", "")
        if not c_compact:
            continue
        if c in key or c_compact in compact or compact in c_compact:
            return choice
        score = levenshtein(compact, c_compact)
        if score < best_score:
            best_score = score
            best = choice

    if not best:
        return ""
    max_allowed = max(3, int(len(re.sub(r"\s+", "", arabic_letters_only(best))) * 0.45))
    return best if best_score <= max_allowed else ""


def normalize_document_number(value=""):
    raw = to_western_digits(clean_value(value)).upper()
    raw = raw.replace("O", "0").replace("I", "1").replace("L", "1")
    compact = re.sub(r"[^A-Z0-9]", "", raw)

    m = re.search(r"([A-Z])(\d{8})", compact)
    if m:
        return f"{m.group(1)}{m.group(2)}"

    m = re.search(r"([A-Z])\s*(\d[\d\s]{7,12})", raw)
    if m:
        digits = re.sub(r"\D", "", m.group(2))
        if len(digits) >= 8:
            return f"{m.group(1)}{digits[:8]}"

    return ""


def normalize_date_value(value=""):
    raw = to_western_digits(clean_value(value))
    raw = raw.replace("\\", "/").replace("-", "/")
    raw = re.sub(r"\s+", "", raw)

    m = re.search(r"(20\d{2})/(\d{1,2})/(\d{1,2})", raw)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"

    m = re.search(r"(\d{1,2})/(\d{1,2})/(20\d{2})", raw)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"

    return ""


def sanitize_warehouse_name(value="", fallback=""):
    merged = clean_value(value or fallback)
    merged = re.sub(
        r"^(?:\u0627\u0644\u062c\u0647\u0629\s+\u0627\u0644\u0645\u062c\u0647\u0632\u0629|\u0627\u0644\u062c\u0647\u0647\s+\u0627\u0644\u0645\u062c\u0647\u0632\u0647|\u0627\u0633\u0645\s+\u0627\u0644\u062c\u0647\u0629\s+\u0627\u0644\u0645\u062c\u0647\u0632\u0629)\s*",
        "",
        merged,
    )
    merged = re.sub(
        r"^.*?(?=(?:\u0645\u0633\u062a\u0648\u062f\u0639|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629))",
        "",
        merged,
    )
    merged = re.sub(r"20\d{2}[-/]\d{1,2}[-/]\d{1,2}", " ", merged)
    merged = re.sub(r"\b\d{4,}\b", " ", merged)
    merged = re.sub(r"\s+", " ", merged).strip()

    normalized = normalize_arabic(merged)
    normalized = (
        normalized
        .replace("\u0645\u0635\u0646\u0649", "\u0645\u0635\u0641\u0649")
        .replace("\u0645\u0635\u0641\u064a", "\u0645\u0635\u0641\u0649")
        .replace("\u0627\u0644\u0633\u0645\u0627\u0648\u0647", "\u0627\u0644\u0633\u0645\u0627\u0648\u0629")
        .replace("\u0627\u0644\u0633\u0645\u0627\u0631\u0629", "\u0627\u0644\u0633\u0645\u0627\u0648\u0629")
        .replace("\u0627\u0644\u0630\u0627\u0635\u0631\u0628\u0629", "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629")
        .replace("\u0627\u0644\u0630\u0627\u0635\u0631\u0628\u0647", "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629")
        .replace("\u0627\u0644\u0630\u0627\u0635\u0631\u064a\u0629", "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629")
        .replace("\u0627\u0644\u0630\u0627\u0635\u0631\u064a\u0647", "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629")
    )
    normalized = re.sub(
        r"\b(?:\u0627\u0644\u0627\u0635\u062f\u0627\u0631|\u0627\u0635\u062f\u0627\u0631|\u0627\u0644\u0627\u0635\u062f\u0631|\u0627\u0635\u062f\u0631)\b",
        " ",
        normalized,
    )
    normalized = re.sub(r"\s+", " ", normalized).strip()

    if (
        any(x in normalized for x in ["\u0645\u0635\u0641\u0649", "\u0645\u0635\u0641\u0627\u0629"])
        and "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629" in normalized
    ):
        return "\u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629"

    if (
        any(x in normalized for x in ["\u0627\u0644\u0634\u0639\u0628\u064a\u0629", "\u0627\u0644\u0634\u0639\u064a\u0628\u0629"])
        and any(x in normalized for x in ["\u0645\u0633\u062a\u0648\u062f\u0639", "\u0645\u0635\u0641\u0649", "\u0645\u0635\u0641\u0627\u0629"])
    ):
        return "\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u0634\u0639\u0628\u064a\u0629"

    if (
        any(x in normalized for x in ["\u0627\u0644\u0633\u0645\u0627\u0648\u0629", "\u0627\u0644\u0633\u0645\u0627\u0648\u0647"])
        and any(x in normalized for x in ["\u0645\u0635\u0641\u0649", "\u0645\u0635\u0641\u0627\u0629"])
    ):
        return "\u0645\u0635\u0641\u0649 \u0627\u0644\u0633\u0645\u0627\u0648\u0629"

    found = best_known_warehouse_match(normalized)
    if found:
        return found

    if "\u0645\u0635\u0641\u0649" in normalized and any(token in normalized for token in [
        "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0647",
        "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629",
        "\u0642\u0627\u0635\u0631\u0628\u0647",
        "\u0642\u0627\u0635\u0631\u0628\u0629",
    ]):
        return "\u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629"

    if any(token in normalized for token in [
        "\u0630\u064a \u0642\u0627\u0631",
        "\u0630\u064a\u0642\u0627\u0631",
        "\u0630\u064a \u0642\u0627\u0632",
        "\u0630\u064a\u0642\u0627\u0632",
    ]) and re.search(r"\u0645\u0635[^\s]{1,4}", normalized):
        return "\u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629"

    return normalized


def sanitize_driver_name(value=""):
    v = clean_value(value)
    v = re.sub(r"^[طں?.,طŒط›:\-_\s]+", "", v)

    noise_patterns = [
        r"ط§ط³ظ…\s*ط§ظ„ط³ط§ط¦ظ‚",
        r"ط§ط³ظ…\s*ط§ظ„ط§ظ….*",
        r"ط§ط³ظ…\s*ط§ظ„ط£ظ….*",
        r"ط±ظ‚ظ…\s*ط§ظ„ظ‡ظˆظٹظ‡.*",
        r"ط±ظ‚ظ…\s*ط§ظ„ظ‡ظˆظٹط©.*",
        r"طھط§ط±ظٹط®\s*ط§ظ„ظ‡ظˆظٹظ‡.*",
        r"طھط§ط±ظٹط®\s*ط§ظ„ظ‡ظˆظٹط©.*",
        r"ط§ظ„طھظˆظ‚ظٹط¹.*",
        r"ط§ظ„ط¹ظ†ظˆط§ظ†\s*ط§ظ„ظˆط¸ظٹظپظٹ.*",
        r"ظ…ظ‡ظ†ط¯ط³.*",
        r"ظˆظ‚طھ\s*ط§ظ„ط§ط±ط³ط§ظ„.*",
        r"ط§ظ„ط³ط§ط¹ط©.*",
        r"ط±ظ‚ظ…\s*ط§ظ„ط¹ط¬ظ„ط©.*",
        r"ط§ظ„ط¬ظ‡ط©.*",
        r"ط§ظ„ظ…ظˆط¸ظپ.*",
        r"ط§ظ„ظ…ظ†طھظˆط¬.*",
        r"طھظپط±ظٹط؛.*",
        r"طھط­ظˆظٹظ„.*",
    ]

    for pattern in noise_patterns:
        v = re.sub(pattern, "", v)

    v = re.sub(r"[^\u0600-\u06FF\s]", " ", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v


def format_vehicle_number_for_output(vehicle_number=""):
    value = clean_value(to_western_digits(vehicle_number)).upper()
    if not value:
        return ""

    value = re.sub(r"\s+", "", value)

    m = re.match(r"^(\d{4,6})/(\d{1,3}[A-Z])$", value)
    if m:
        return f"{m.group(2)}{m.group(1)}"

    m = re.match(r"^(\d{1,3}[A-Z])/(\d{4,6})$", value)
    if m:
        return f"{m.group(1)}{m.group(2)}"

    return value


def format_vehicle_number_document(vehicle_number="", governorate=""):
    value = clean_value(to_western_digits(vehicle_number)).upper()
    governorate = clean_value(governorate)
    if not value:
        return ""

    value = re.sub(r"\s+", "", value)

    m = re.match(r"^(\d{4,6})/([0-9A-Z]{2,4})$", value, re.I)
    if m:
        return f"{m.group(1)}/{m.group(2).upper()}{f' {governorate}' if governorate else ''}".strip()

    m = re.match(r"^([0-9A-Z]{2,4})/(\d{4,6})$", value, re.I)
    if m:
        return f"{m.group(2)}/{m.group(1).upper()}{f' {governorate}' if governorate else ''}".strip()

    if governorate and re.match(r"^[\u0621-\u064A]\d{4,6}$", value):
        return f"{value[1:]}/{value[0]} {governorate}".strip()

    return format_vehicle_number_for_output(value)


def _repair_vehicle_ocr_text(text=""):
    t = to_western_digits(clean_value(text)).upper()
    t = t.replace(" ", "")
    t = t.replace("O", "0")
    t = t.replace("I", "1")

    replacements = [
        ("ظ،ظ©A", "19A"),
        ("19ظ¤", "19A"),
        ("19ط§", "19A"),
        ("19ط£", "19A"),
        ("19ط¢", "19A"),
        ("19ط،", "19A"),
        ("19ط¹", "19A"),
        ("19ظ‡", "19A"),
        ("19ظ‰", "19A"),
    ]
    for src, dst in replacements:
        t = t.replace(src, dst)

    return t


def normalize_vehicle_suffix(value=""):
    suffix = clean_value(to_western_digits(value)).upper()
    suffix = re.sub(r"[^A-Z0-9]", "", suffix)
    if not suffix:
        return ""

    if re.match(r"^\d{2}[A-Z]$", suffix):
        return suffix

    ambiguous_tail_map = {
        "3": "B",
        "8": "B",
        "4": "A",
    }

    if re.match(r"^\d{2}\d$", suffix):
        mapped = ambiguous_tail_map.get(suffix[-1], "")
        if mapped:
            return f"{suffix[:2]}{mapped}"

    if re.match(r"^\d{2}\d[A-Z]$", suffix):
        return f"{suffix[:2]}{suffix[-1]}"

    return suffix


def normalize_arabic_plate_letter(value=""):
    letter = clean_value(value)
    if not letter:
        return ""

    match = re.search(r"[\u0621-\u064A]", letter)
    if not match:
        return ""

    normalized = match.group(0)
    if normalized in ("ا", "أ", "إ", "آ"):
        return "أ"
    return normalized


def parse_vehicle_field(value=""):
    raw = clean_value(to_western_digits(value))
    if not raw:
        return {"vehicleNumber": "", "vehicleNumberRaw": "", "vehicleGovernorate": ""}

    # Keep a default value so early-return branches can safely format vehicle text.
    governorate = ""
    raw_compact = re.sub(r"\s+", " ", raw).strip()
    raw_slash_match = (
        re.search(r"(?:^|\s)(\d{4,6})/([0-9A-Z]{2,4})(?:\s|$)", raw_compact, re.I)
        or re.search(r"(?:^|\s)([0-9A-Z]{2,4})/(\d{4,6})(?:\s|$)", raw_compact, re.I)
    )
    if raw_slash_match:
        a, b = raw_slash_match.group(1), raw_slash_match.group(2)
        b = normalize_vehicle_suffix(b)
        if re.match(r"^\d{4,6}$", a) and re.match(r"^\d{2}[A-Z]$", b, re.I):
            return {
                "vehicleNumber": format_vehicle_number_document(f"{a}/{b}", governorate),
                "vehicleNumberCanonical": format_vehicle_number_for_output(f"{a}/{b}"),
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": "",
            }
        a = normalize_vehicle_suffix(a)
        if re.match(r"^\d{2}[A-Z]$", a, re.I) and re.match(r"^\d{4,6}$", b):
            return {
                "vehicleNumber": format_vehicle_number_document(f"{a}/{b}", governorate),
                "vehicleNumberCanonical": format_vehicle_number_for_output(f"{a}/{b}"),
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": "",
            }

    text = _repair_vehicle_ocr_text(raw)
    normalized_ar = normalize_arabic(raw)

    governorate_aliases = [
        ("ظƒط±ط¨ظ„ط§ط،", ["ظƒط±ط¨ظ„ط§ط،", "ظƒط±ط¨ظ„ط§"]),
        ("ط§ظ„ظ†ط¬ظپ", ["ط§ظ„ظ†ط¬ظپ", "ظ†ط¬ظپ"]),
        ("ط¨ط؛ط¯ط§ط¯", ["ط¨ط؛ط¯ط§ط¯"]),
        ("ط§ظ„ط¨طµط±ط©", ["ط§ظ„ط¨طµط±ط©", "ط§ظ„ط¨طµط±ظ‡", "ط¨طµط±ط©", "ط¨طµط±ظ‡"]),
        ("ظ†ظٹظ†ظˆظ‰", ["ظ†ظٹظ†ظˆظ‰", "ظ†ظٹظ†ظˆظٹ"]),
        ("ط£ط±ط¨ظٹظ„", ["ط§ط±ط¨ظٹظ„", "ط£ط±ط¨ظٹظ„"]),
        ("ط§ظ„ط£ظ†ط¨ط§ط±", ["ط§ظ„ط£ظ†ط¨ط§ط±", "ط§ظ„ط§ظ†ط¨ط§ط±", "ط§ظ†ط¨ط§ط±"]),
        ("ط¨ط§ط¨ظ„", ["ط¨ط§ط¨ظ„", "ط­ظ„ظ‡", "ط­ظ„ط©"]),
        ("ط¯ظٹط§ظ„ظ‰", ["ط¯ظٹط§ظ„ظ‰", "ط¯ظٹط§ظ„ظٹ"]),
        ("ط°ظٹ ظ‚ط§ط±", ["ط°ظٹ ظ‚ط§ط±", "ط°ظٹظ‚ط§ط±"]),
        ("طµظ„ط§ط­ ط§ظ„ط¯ظٹظ†", ["طµظ„ط§ط­ ط§ظ„ط¯ظٹظ†", "طµظ„ط§ط­ط§ظ„ط¯ظٹظ†"]),
        ("ط§ظ„ط³ظ„ظٹظ…ط§ظ†ظٹط©", ["ط§ظ„ط³ظ„ظٹظ…ط§ظ†ظٹط©", "ط³ظ„ظٹظ…ط§ظ†ظٹط©", "ط³ظ„ظٹظ…ط§ظ†ظٹظ‡"]),
        ("ظˆط§ط³ط·", ["ظˆط§ط³ط·"]),
        ("ظ…ظٹط³ط§ظ†", ["ظ…ظٹط³ط§ظ†"]),
        ("ط§ظ„ظ…ط«ظ†ظ‰", ["ط§ظ„ظ…ط«ظ†ظ‰", "ظ…ط«ظ†ظ‰"]),
        ("ظƒط±ظƒظˆظƒ", ["ظƒط±ظƒظˆظƒ"]),
        ("ط¯ظ‡ظˆظƒ", ["ط¯ظ‡ظˆظƒ"]),
        ("ط§ظ„ظ‚ط§ط¯ط³ظٹط©", ["ط§ظ„ظ‚ط§ط¯ط³ظٹط©", "ظ‚ط§ط¯ط³ظٹط©", "ط§ظ„ظ‚ط§ط¯ط³ظٹظ‡"]),
    ]

    for canonical, variants in governorate_aliases:
        for variant in variants:
            if normalize_arabic(variant) in normalized_ar:
                governorate = canonical
                break
        if governorate:
            break
    if not governorate:
        direct_governorates = {
            "\u0646\u062c\u0641": "\u0646\u062c\u0641",
            "\u0643\u0631\u0628\u0644\u0627\u0621": "\u0643\u0631\u0628\u0644\u0627\u0621",
            "\u0628\u063a\u062f\u0627\u062f": "\u0628\u063a\u062f\u0627\u062f",
            "\u0628\u0635\u0631\u0629": "\u0628\u0635\u0631\u0629",
            "\u0645\u064a\u0633\u0627\u0646": "\u0645\u064a\u0633\u0627\u0646",
            "\u0648\u0627\u0633\u0637": "\u0648\u0627\u0633\u0637",
            "\u0628\u0627\u0628\u0644": "\u0628\u0627\u0628\u0644",
            "\u0630\u064a \u0642\u0627\u0631": "\u0630\u064a \u0642\u0627\u0631",
        }
        for token, canonical in direct_governorates.items():
            if token in raw or token in normalized_ar:
                governorate = canonical
                break

    arabic_candidates = []

    def push_arabic_candidate(digits="", letter="", score=0):
        digits = "".join(re.findall(r"\d", to_western_digits(digits or "")))
        digits = digits[-6:]
        if len(digits) < (3 if governorate else 4):
            return

        letter = normalize_arabic_plate_letter(letter)
        if not letter:
            return

        total_score = score + len(digits)
        if governorate:
            total_score += 2

        arabic_candidates.append({
            "digits": digits,
            "letter": letter,
            "score": total_score,
        })

    def score_arabic_letter(letter=""):
        letter = normalize_arabic_plate_letter(letter)
        if not letter:
            return -999
        if letter == "أ":
            return 16
        if letter in {"ا", "إ", "آ"}:
            return 14
        if letter in {"ب", "ج", "ح", "د", "ر", "س", "ص", "ط", "ل", "م", "ن", "و", "ي"}:
            return 8
        if letter in {"ف", "ق"}:
            return 2
        return 5

    for m in re.finditer(r"(\d{3,4})\s+(\d)\s*/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF]+))?", raw):
        merged_digits = f"{m.group(2)}{m.group(1)}"
        push_arabic_candidate(merged_digits, m.group(3), 34 + score_arabic_letter(m.group(3)))

    for m in re.finditer(r"([\u0621-\u064A])\s+(\d)\s*/\s*(\d{4,6})(?:\s+([\u0600-\u06FF]+))?", raw):
        long_digits = m.group(3)
        push_arabic_candidate(long_digits, m.group(1), 36 + score_arabic_letter(m.group(1)))

    for m in re.finditer(r"([\u0621-\u064A])\s+(\d{1,2})\s*/\s*(\d{3,5})(?:\s+([\u0600-\u06FF]+))?", raw):
        left_digits = m.group(2)
        right_digits = m.group(3)
        merged_digits = f"{left_digits}{right_digits}"
        if len(merged_digits) > 6:
            merged_digits = right_digits
        push_arabic_candidate(merged_digits, m.group(1), 28 + score_arabic_letter(m.group(1)))

    neighborhood_patterns = [
        r"([\u0621-\u064A])\s+\d\s*/\s*(\d{4,6})",
        r"([\u0621-\u064A])\s+(\d{4,6})",
        r"(\d{4,6})\s*/\s*([\u0621-\u064A])",
    ]
    for pattern in neighborhood_patterns:
        for m in re.finditer(pattern, raw):
            if re.search(r"[\u0621-\u064A]", m.group(1)):
                letter, digits = m.group(1), m.group(2)
            else:
                digits, letter = m.group(1), m.group(2)
            push_arabic_candidate(digits, letter, 22 + score_arabic_letter(letter))

    for m in re.finditer(r"([\u0621-\u064A])\s*(?:\d{0,2}\s*[/\-]\s*)?(\d{4,6})", raw):
        push_arabic_candidate(m.group(2), m.group(1), 20 + score_arabic_letter(m.group(1)))

    for m in re.finditer(r"(\d{4,6})\s*[/\-]\s*([\u0621-\u064A])(?:\s|$)", raw):
        push_arabic_candidate(m.group(1), m.group(2), 12 + score_arabic_letter(m.group(2)))

    if arabic_candidates:
        grouped_candidates = {}
        for item in arabic_candidates:
            key = item["digits"]
            bucket = grouped_candidates.setdefault(key, [])
            bucket.append(item)

        boosted_candidates = []
        for digits, bucket in grouped_candidates.items():
            letters = {candidate["letter"] for candidate in bucket}
            prefer_alef = governorate and "أ" in letters and any(letter in letters for letter in ("ف", "ق"))
            for candidate in bucket:
                boosted = dict(candidate)
                if prefer_alef and candidate["letter"] == "أ":
                    boosted["score"] += 35
                if prefer_alef and candidate["letter"] in ("ف", "ق"):
                    boosted["score"] -= 12
                boosted_candidates.append(boosted)

        arabic_candidates = boosted_candidates
        arabic_candidates.sort(
            key=lambda item: (
                -item["score"],
                -len(item["digits"]),
                0 if item["letter"] == "أ" else 1,
                0 if item["letter"] == "ا" else 1,
                item["digits"],
            )
        )
        best_arabic = arabic_candidates[0]
        return {
            "vehicleNumber": format_vehicle_number_document(
                f"{best_arabic['letter']}{best_arabic['digits']}",
                governorate,
            ),
            "vehicleNumberCanonical": f"{best_arabic['letter']}{best_arabic['digits']}",
            "vehicleNumberRaw": raw,
            "vehicleGovernorate": governorate,
        }

    patterns = [
        r"(\d{4,6})/([0-9A-Z]{2,4})",
        r"([0-9A-Z]{2,4})/(\d{4,6})",
        r"(\d{4,6})(\d{2}[A-Z])",
        r"(\d{4,6})[/\-]?(\d{2}[A])",
    ]

    for p in patterns:
        m = re.search(p, text)
        if not m:
            continue

        a, b = m.group(1), m.group(2)
        a = normalize_vehicle_suffix(a)
        b = normalize_vehicle_suffix(b)

        if re.match(r"^\d{2}[A-Z]$", a) and re.match(r"^\d{4,6}$", b):
            formatted = format_vehicle_number_for_output(f"{a}/{b}")
            return {
                "vehicleNumber": format_vehicle_number_document(formatted, governorate),
                "vehicleNumberCanonical": formatted,
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

        if re.match(r"^\d{4,6}$", a) and re.match(r"^\d{2}[A-Z]$", b):
            formatted = format_vehicle_number_for_output(f"{a}/{b}")
            return {
                "vehicleNumber": format_vehicle_number_document(formatted, governorate),
                "vehicleNumberCanonical": formatted,
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

        if re.match(r"^\d{4,6}$", a) and re.match(r"^\d{2}[A-Z]$", b):
            formatted = format_vehicle_number_for_output(f"{a}/{b}")
            return {
                "vehicleNumber": format_vehicle_number_document(formatted, governorate),
                "vehicleNumberCanonical": formatted,
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

    if governorate:
        m = re.search(r"(\d{4,6})/[\u0600-\u06FF]+", raw)
        if m:
            return {
                "vehicleNumber": format_vehicle_number_document(m.group(1), governorate),
                "vehicleNumberCanonical": m.group(1),
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

        m = re.search(r"[\u0600-\u06FF]+/(\d{4,6})", raw)
        if m:
            return {
                "vehicleNumber": format_vehicle_number_document(m.group(1), governorate),
                "vehicleNumberCanonical": m.group(1),
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

    m = re.search(r"(\d{2}[A-Z]\d{4,6})", text)
    if m:
            return {
                "vehicleNumber": format_vehicle_number_document(m.group(1), governorate),
                "vehicleNumberCanonical": m.group(1),
                "vehicleNumberRaw": raw,
                "vehicleGovernorate": governorate,
            }

    nums = re.findall(r"\d{4,6}", text)
    if nums:
        return {
            "vehicleNumber": nums[0],
            "vehicleNumberRaw": raw,
            "vehicleGovernorate": governorate,
        }

    return {
        "vehicleNumber": "",
        "vehicleNumberCanonical": "",
        "vehicleNumberRaw": raw,
        "vehicleGovernorate": governorate,
    }


def canonical_document_type(value=""):
    raw = clean_value(value)
    if not raw:
        return ""

    raw = to_western_digits(raw)
    normalized = normalize_arabic(raw)
    normalized = normalized.replace("I68", "68").replace("L68", "68").replace("168", "68")
    normalized = re.sub(r"[^\d\u0621-\u064A\s\-_\/]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    compact = normalized.replace(" ", "").replace("-", "").replace("_", "").replace("/", "")

    if re.search(r"126\s*طھطµط¯ظٹط±", normalized) or "126طھطµط¯ظٹط±" in compact:
        return "126 طھطµط¯ظٹط±"

    m = re.search(r"68\s*([ط§ط¨ط¬])", normalized)
    if m:
        return f"68{m.group(1)}"

    m = re.search(r"([ط§ط¨ط¬])\s*68", normalized)
    if m:
        return f"68{m.group(1)}"

    has_68 = "68" in compact
    chars = re.findall(r"[ط§ط¨ط¬]", normalized)
    if has_68 and chars:
        return f"68{chars[0]}"

    return ""


def normalize_receiver_search_text(value=""):
    value = normalize_arabic(clean_value(value))
    value = re.sub(r"[^\u0600-\u06FF0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()

    replacements = [
        ("ط§ظ„ط° ظ‡ط¨ظٹ", "ط§ظ„ط°ظ‡ط¨ظٹ"),
        ("ط§ظ„ط° ظ‡ ط¨ظٹ", "ط§ظ„ط°ظ‡ط¨ظٹ"),
        ("ط§ظ„ط°ظ‡ ط¨ظٹ", "ط§ظ„ط°ظ‡ط¨ظٹ"),
        ("ط§ظ„ط¯ظ‡ط¨ظٹ", "ط§ظ„ط°ظ‡ط¨ظٹ"),
        ("ط§ظ„ط²ظ‡ط¨ظٹ", "ط§ظ„ط°ظ‡ط¨ظٹ"),
        ("ظ…طµظپظٹ", "ظ…طµظپظ‰"),
        ("ظ…طµظپ ط§ظ‡", "ظ…طµظپط§ط©"),
        ("ظ…طµظپط§ظ‡", "ظ…طµظپط§ط©"),
        ("ط§ظ„ظ…طµظپظٹ", "ط§ظ„ظ…طµظپظ‰"),
        ("ظ†ظپ ط·", "ظ†ظپط·"),
        ("ط§ظ„ط§ط³ظپظ„طھ", "ط§ظ„ط§ط³ظپظ„طھ"),
        ("ط§ظ„ط§ط³ظپظ„طھ ط§ظ„ظ…ط¤ظƒط³ط¯", "ط§ظ„ط§ط³ظپظ„طھ ط§ظ„ظ…ط¤ظƒط³ط¯"),
        ("ط§ظ„ظ…ظˆظƒط³ط¯", "ط§ظ„ظ…ط¤ظƒط³ط¯"),
        ("ط§ظ„ظ…ط¤ظƒط³ط¯", "ط§ظ„ظ…ط¤ظƒط³ط¯"),
    ]

    for src, dst in replacements:
        value = value.replace(src, dst)

    return re.sub(r"\s+", " ", value).strip()


def receiver_phrase_score(text=""):
    n = normalize_receiver_search_text(text)
    score = 0
    if "ظ…طµظپظ‰" in n or "ظ…طµظپط§ط©" in n or "ظ…طµظپ" in n:
        score += 3
    if "ط§ظ„ظ†ظپط·" in n:
        score += 3
    if "ط§ظ„ط°ظ‡ط¨ظٹ" in n or "ط§ظ„ط°ظ‡ط¨" in n:
        score += 3
    if "ط§ط³ظپظ„طھ" in n:
        score += 1
    if "ظ…ط¤ظƒط³ط¯" in n:
        score += 1
    return score


def _contains_broken_word(text="", target=""):
    compact_text = normalize_receiver_search_text(text).replace(" ", "")
    compact_target = normalize_receiver_search_text(target).replace(" ", "")
    return compact_target in compact_text


def extract_receiver_phrase(text=""):
    raw = clean_value(text)
    if not raw:
        return ""

    normalized = normalize_receiver_search_text(raw)

    has_refinery = (
        "ظ…طµظپظ‰" in normalized
        or "ظ…طµظپط§ط©" in normalized
        or "ظ…طµظپ" in normalized
        or _contains_broken_word(normalized, "ظ…طµظپظ‰")
    )
    has_oil = "ط§ظ„ظ†ظپط·" in normalized or _contains_broken_word(normalized, "ط§ظ„ظ†ظپط·")
    has_gold = (
        "ط§ظ„ط°ظ‡ط¨ظٹ" in normalized
        or "ط§ظ„ط°ظ‡ط¨ظٹط©" in normalized
        or "ط§ظ„ط°ظ‡ط¨" in normalized
        or _contains_broken_word(normalized, "ط§ظ„ط°ظ‡ط¨ظٹ")
    )
    has_context = (
        "ظ…ط¹ظ…ظ„" in normalized
        or "ظ…طµظپظ‰" in normalized
        or "ظ…طµظپط§ط©" in normalized
        or "ط§ظ„ط´ط¨ظƒط©" in normalized
        or "ط§ظ„ظ‚ط§ط¨ط¶ط©" in normalized
        or "ط§ظ„ظ‚ط§ط¨ط¶ظ‡" in normalized
        or "ظ… ط§ظ„ظ†ظپط·" in normalized
        or "ظ…. ط§ظ„ظ†ظپط·" in normalized
    )
    has_holding = (
        ("ط§ظ„ط°ظ‡ط¨ظٹط©" in normalized or _contains_broken_word(normalized, "ط§ظ„ط°ظ‡ط¨ظٹط©"))
        and ("ط§ظ„ظ‚ط§ط¨ط¶ط©" in normalized or "ط§ظ„ظ‚ط§ط¨ط¶ظ‡" in normalized)
    )

    if has_refinery and has_oil and has_gold:
        return CANONICAL_RECEIVER

    if "ظ…طµظپظ‰ ط§ظ„ظ†ظپط· ط§ظ„ط°ظ‡ط¨ظٹ" in normalized or "ظ…طµظپط§ط© ط§ظ„ظ†ظپط· ط§ظ„ط°ظ‡ط¨ظٹ" in normalized:
        return CANONICAL_RECEIVER

    if has_gold and has_context and (has_oil or has_holding):
        return CANONICAL_RECEIVER

    return raw


def extract_quantity_from_text(value=""):
    raw = to_western_digits(clean_value(value))
    nums = re.findall(r"\d{3,6}", raw)
    valid = [int(n) for n in nums if 1000 <= int(n) <= 60000]
    if valid:
        return max(valid)
    return 0


def _image_cache_key(image, allowlist=None, paragraph=False, detail=0):
    try:
        img_hash = hash(image.tobytes())
    except Exception:
        img_hash = id(image)
    return (img_hash, allowlist or "", paragraph, detail)


def read_text(image, allowlist=None, paragraph=False, detail=0):
    cache_key = _image_cache_key(image, allowlist, paragraph, detail)
    if cache_key in OCR_CACHE:
        return OCR_CACHE[cache_key]

    result = READER.readtext(
        image,
        detail=detail,
        paragraph=paragraph,
        allowlist=allowlist,
        batch_size=4,
    )

    if isinstance(result, list):
        texts = []
        for item in result:
            if isinstance(item, str):
                texts.append(item)
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                texts.append(str(item[1]))
        final_text = clean_value(" ".join(texts))
    else:
        final_text = clean_value(result)

    OCR_CACHE[cache_key] = final_text
    return final_text


def read_layout_items(crop):
    cache_key = _image_cache_key(crop, "__layout_items__", False, 1)
    if cache_key in OCR_CACHE:
        return OCR_CACHE[cache_key]

    result = READER.readtext(crop, detail=1, paragraph=False, batch_size=4)
    items = []

    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        bbox, text, confidence = item
        items.append({
            "bbox": bbox,
            "text": str(text),
            "confidence": float(confidence),
        })

    OCR_CACHE[cache_key] = items
    return items


def read_text_rtl(crop):
    items = read_layout_items(crop)
    if not items:
        return ""

    rows = []
    sorted_items = sorted(items, key=lambda item: min(pt[1] for pt in item["bbox"]))

    for item in sorted_items:
        y_top = min(pt[1] for pt in item["bbox"])
        y_bottom = max(pt[1] for pt in item["bbox"])
        x_left = min(pt[0] for pt in item["bbox"])
        x_right = max(pt[0] for pt in item["bbox"])
        text = clean_value(item["text"])
        if not text:
            continue

        assigned = False
        for row in rows:
            overlap = min(y_bottom, row["bottom"]) - max(y_top, row["top"])
            if overlap >= -4:
                row["top"] = min(row["top"], y_top)
                row["bottom"] = max(row["bottom"], y_bottom)
                row["items"].append((x_left, x_right, text))
                assigned = True
                break

        if not assigned:
            rows.append({
                "top": y_top,
                "bottom": y_bottom,
                "items": [(x_left, x_right, text)],
            })

    parts = []
    for row in sorted(rows, key=lambda r: r["top"]):
        for _, x_right, text in sorted(row["items"], key=lambda t: t[1], reverse=True):
            if text:
                parts.append(text)

    return clean_value(" ".join(parts))


def load_template_fields(template_name=DEFAULT_TEMPLATE_NAME):
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", str(template_name or DEFAULT_TEMPLATE_NAME))
    template_path = TEMPLATES_DIR / f"{safe_name}.json"

    if not template_path.exists():
        raise FileNotFoundError(f"ط§ظ„ظ‚ط§ظ„ط¨ ط؛ظٹط± ظ…ظˆط¬ظˆط¯: {template_path}")

    content = template_path.read_text(encoding="utf-8")
    data = json.loads(content)

    fields = data.get("fields") or {}
    if not isinstance(fields, dict) or not fields:
        raise ValueError("ط§ظ„ظ‚ط§ظ„ط¨ ظ„ط§ ظٹط­طھظˆظٹ ط¹ظ„ظ‰ fields طµط§ظ„ط­ط©")

    return fields, data


def load_layout_fields(image, fields):
    try:
        result = extract_fields_by_labels(image, fields)
        if isinstance(result, dict):
            layout_fields = result.get("fields") or {}
            layout_items = result.get("items") or []
            return layout_fields, layout_items
    except Exception:
        pass
    return {}, []


def order_points(pts):
    pts = np.array(pts, dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    return np.array([
        pts[np.argmin(s)],
        pts[np.argmin(diff)],
        pts[np.argmax(s)],
        pts[np.argmax(diff)],
    ], dtype="float32")


def warp_document_quad(image, pts):
    rect = order_points(pts)
    (tl, tr, br, bl) = rect

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = int(max(width_a, width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = int(max(height_a, height_b))

    if max_width < 600 or max_height < 600:
        return image

    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1],
    ], dtype="float32")

    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(
        image,
        matrix,
        (max_width, max_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def detect_document_quad(image):
    if image is None or image.size == 0:
        return None

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blur, 35, 140)
    kernel = np.ones((5, 5), np.uint8)
    edged = cv2.dilate(edged, kernel, iterations=2)
    edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(image.shape[0] * image.shape[1])
    best_quad = None
    best_area = 0.0

    for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
        area = cv2.contourArea(cnt)
        if area < image_area * 0.18:
            continue

        perimeter = cv2.arcLength(cnt, True)
        if perimeter <= 0:
            continue

        approx = cv2.approxPolyDP(cnt, 0.02 * perimeter, True)
        if len(approx) != 4:
            rect = cv2.minAreaRect(cnt)
            box = cv2.boxPoints(rect)
            approx = box.reshape(-1, 1, 2)

        if len(approx) != 4:
            continue

        if area > best_area:
            best_area = area
            best_quad = approx.reshape(4, 2)

    return best_quad


def deskew_image(image):
    if image is None or image.size == 0:
        return image

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(th)
    if coords is None or len(coords) < 100:
        return image

    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 0.35 or abs(angle) > 10:
        return image

    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        image,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def normalize_document_image(image):
    quad = detect_document_quad(image)
    corrected = warp_document_quad(image, quad) if quad is not None else image
    corrected = deskew_image(corrected)
    corrected = cv2.convertScaleAbs(corrected, alpha=1.08, beta=4)
    return corrected


def preprocess_image(image_path):
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("طھط¹ط°ط± ظ‚ط±ط§ط،ط© ط§ظ„طµظˆط±ط©")

    h, w = image.shape[:2]
    if w < TARGET_MIN_WIDTH:
        scale = TARGET_MIN_WIDTH / max(w, 1)
        image = cv2.resize(
            image,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_LINEAR,
        )

    return normalize_document_image(image)


def crop_relative(image, zone, expand_x=0.0, expand_y=0.0, offset_x=0.0, offset_y=0.0):
    h, w = image.shape[:2]
    x = int((zone["x"] - expand_x + offset_x) * w)
    y = int((zone["y"] - expand_y + offset_y) * h)
    cw = int((zone["w"] + 2 * expand_x) * w)
    ch = int((zone["h"] + 2 * expand_y) * h)

    x = max(0, x)
    y = max(0, y)
    cw = max(1, min(cw, w - x))
    ch = max(1, min(ch, h - y))

    return image[y:y + ch, x:x + cw]


def crop_by_relative_box(image, x, y, w, h):
    ih, iw = image.shape[:2]
    x1 = max(0, int(x * iw))
    y1 = max(0, int(y * ih))
    x2 = min(iw, int((x + w) * iw))
    y2 = min(ih, int((y + h) * ih))
    return image[y1:y2, x1:x2]


def prepare_crop(crop, min_size=180, threshold=None, denoise=False, invert=False):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop

    if denoise:
        gray = cv2.GaussianBlur(gray, (3, 3), 0)

    if threshold is not None:
        _, gray = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    if invert:
        gray = 255 - gray

    h, w = gray.shape[:2]
    if min(h, w) < min_size:
        scale = min(
            max(min_size / max(h, 1), min_size / max(w, 1), 1.15),
            CROP_UPSCALE_LIMIT,
        )
        gray = cv2.resize(
            gray,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_LINEAR,
        )

    return gray


def relative_subcrop(crop, left=0.0, top=0.0, right=1.0, bottom=1.0):
    if crop is None or crop.size == 0:
        return crop
    h, w = crop.shape[:2]
    x1 = max(0, min(w - 1, int(w * left)))
    y1 = max(0, min(h - 1, int(h * top)))
    x2 = max(x1 + 1, min(w, int(w * right)))
    y2 = max(y1 + 1, min(h, int(h * bottom)))
    return crop[y1:y2, x1:x2]


def build_focus_crops(crop, mode="generic"):
    if crop is None or crop.size == 0:
        return []

    configs = [(0.0, 0.0, 1.0, 1.0)]
    if mode == "vehicle":
        configs.extend([
            (0.00, 0.00, 1.00, 0.92),
            (0.03, 0.00, 1.00, 0.95),
            (0.00, 0.05, 1.00, 1.00),
            (0.06, 0.00, 0.98, 0.90),
        ])
    elif mode == "driver":
        configs.extend([
            (0.00, 0.00, 1.00, 0.82),
            (0.00, 0.00, 1.00, 0.92),
            (0.02, 0.00, 0.98, 0.88),
            (0.00, 0.05, 1.00, 0.94),
        ])
    elif mode == "warehouse":
        configs.extend([
            (0.00, 0.00, 1.00, 0.88),
            (0.00, 0.04, 1.00, 0.98),
            (0.03, 0.00, 0.98, 0.92),
        ])
    elif mode == "documentType":
        configs.extend([
            (0.00, 0.00, 1.00, 1.00),
            (0.02, 0.00, 0.98, 0.96),
            (0.00, 0.04, 1.00, 1.00),
        ])
    elif mode == "receiver":
        configs.extend([
            (0.00, 0.00, 1.00, 0.55),
            (0.00, 0.00, 1.00, 0.65),
            (0.00, 0.08, 1.00, 0.72),
        ])

    variants = []
    seen = set()
    for left, top, right, bottom in configs:
        variant = relative_subcrop(crop, left, top, right, bottom)
        if variant is None or variant.size == 0:
            continue
        key = (variant.shape[0], variant.shape[1], int(np.mean(variant)))
        if key in seen:
            continue
        seen.add(key)
        variants.append(variant)
    return variants


def is_strong_document_type(value=""):
    value = clean_value(value)
    return value in {"68ا", "68ب", "68ج", "126 تصدير", "90"}


def is_strong_warehouse_result(best_value="", scored=None):
    scored = scored or []
    if not best_value:
        return False
    if not scored:
        return len(best_value.split()) <= 5
    return float(scored[0].get("confidence", 0)) >= 0.78


def is_strong_vehicle_result(parsed=None):
    parsed = parsed or {}
    number = clean_value(parsed.get("vehicleNumber", ""))
    digits = "".join(re.findall(r"\d", to_western_digits(number)))
    letter = normalize_arabic_plate_letter(number)
    governorate = clean_value(parsed.get("vehicleGovernorate", ""))
    return bool(letter and len(digits) >= 5 and governorate)


def is_strong_driver_result(name=""):
    parts = [p for p in clean_value(name).split() if p]
    return len(parts) >= 4


def classify_polygon_shape(approx, area, perimeter):
    sides = len(approx)
    if perimeter <= 0:
        return ""
    circularity = 4 * 3.141592653589793 * area / (perimeter * perimeter)

    if sides == 4:
        return "quadrilateral"
    if sides == 5:
        return "pentagon"
    if sides == 6:
        return "hexagon"
    if sides >= 8 and circularity >= 0.84:
        return "circle"
    return ""


def detect_document_type_shapes(image):
    roi = crop_by_relative_box(image, 0.06, 0.00, 0.52, 0.24)
    if roi is None or roi.size == 0:
        return []

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    th = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 8
    )

    contours, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    results = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 1000 or area > 90000:
            continue

        perimeter = cv2.arcLength(cnt, True)
        if perimeter <= 0:
            continue

        approx = cv2.approxPolyDP(cnt, 0.02 * perimeter, True)
        shape_type = classify_polygon_shape(approx, area, perimeter)
        if not shape_type:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        if w < 35 or h < 35:
            continue

        ratio = w / max(h, 1)
        if ratio < 0.6 or ratio > 1.8:
            continue

        candidate = roi[y:y + h, x:x + w]
        if candidate.size == 0:
            continue

        score = 0
        if shape_type == "hexagon":
            score += 6
        elif shape_type in {"pentagon", "quadrilateral", "circle"}:
            score += 5

        if 40 <= w <= 220:
            score += 2
        if 40 <= h <= 220:
            score += 2

        results.append({
            "shapeType": shape_type,
            "crop": candidate,
            "score": score,
        })

    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:10]


def detect_shape_type_in_crop(crop):
    if crop is None or crop.size == 0:
        return ""

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    th = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 8
    )
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_shape = ""
    best_area = 0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 500:
            continue
        perimeter = cv2.arcLength(cnt, True)
        if perimeter <= 0:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * perimeter, True)
        shape_type = classify_polygon_shape(approx, area, perimeter)
        if not shape_type:
            continue
        x, y, w, h = cv2.boundingRect(cnt)
        ratio = w / max(h, 1)
        if ratio < 0.6 or ratio > 1.8:
            continue
        if area > best_area:
            best_area = area
            best_shape = shape_type

    return best_shape


def infer_document_type_from_shape_and_text(shape_type, raw_text):
    if shape_type == "quadrilateral":
        return "68\u062c"
    if shape_type == "circle":
        return "68\u0628"
    if shape_type == "pentagon":
        return "68\u0627"
    if shape_type == "hexagon":
        return "126 \u062a\u0635\u062f\u064a\u0631"
    fixed = canonical_document_type(raw_text)
    if fixed:
        return fixed
    return ""


def read_document_type_from_shape_crop(crop, shape_type):
    variants = [
        prepare_crop(crop, min_size=360, threshold=110, invert=False),
        prepare_crop(crop, min_size=360, threshold=140, invert=False),
        prepare_crop(crop, min_size=380, threshold=None, denoise=True, invert=False),
    ]

    raw_candidates = []
    votes = []

    for img in variants:
        txt = read_text(
            img,
            allowlist="0123456789?????????????????????????????????????????????????-/IL ",
            paragraph=False,
        )
        txt = clean_value(txt)
        if txt:
            txt = txt.replace("I68", "68").replace("L68", "68").replace("168", "68")
            raw_candidates.append(txt)

        guessed = infer_document_type_from_shape_and_text(shape_type, txt)
        if guessed:
            votes.append(guessed)

    if votes:
        return Counter(votes).most_common(1)[0][0], raw_candidates

    return "", raw_candidates


def read_document_type(image, fields, crops):
    all_candidates = []
    text_votes = []

    if "documentType" not in crops:
        return "", all_candidates, [], []

    crop = crops["documentType"]
    focus_crops = build_focus_crops(crop, "documentType")
    quick_focus_crops = focus_crops[:1] or [crop]
    retry_focus_crops = focus_crops[1:]
    if FAST_MODE:
        retry_focus_crops = retry_focus_crops[:1]

    raw_reads = []
    for source_crop in quick_focus_crops:
        variants = [
            prepare_crop(source_crop, min_size=260, threshold=135),
            prepare_crop(source_crop, min_size=260, threshold=None, denoise=True),
        ]

        for img in variants:
            txt = read_text(
                img,
                allowlist="0123456789????????????????????????????????????????????-/IL ",
                paragraph=False,
            )
            txt = clean_value(txt)
            if txt:
                txt = txt.replace("I68", "68").replace("L68", "68").replace("168", "68")
                raw_reads.append(txt)

    all_candidates.extend(raw_reads)

    merged = " ".join(raw_reads)
    fixed = canonical_document_type(merged)
    if fixed:
        text_votes.append(fixed)

    shape_votes = []
    crop_shape_type = detect_shape_type_in_crop(crop)
    if crop_shape_type:
        guessed = infer_document_type_from_shape_and_text(crop_shape_type, merged)
        if guessed:
            shape_votes.append(guessed)

    compact = normalize_arabic(merged).replace(" ", "")
    if not text_votes and "68" in compact:
        if "\u062c" in merged:
            text_votes.append("68\u062c")
        elif "\u0628" in merged:
            text_votes.append("68\u0628")
        elif "\u0627" in merged:
            text_votes.append("68\u0627")
        else:
            text_votes.append("68\u062c")

    if text_votes:
        return Counter(text_votes).most_common(1)[0][0], all_candidates, [], text_votes

    if shape_votes:
        return Counter(shape_votes).most_common(1)[0][0], all_candidates, shape_votes, text_votes

    for source_crop in retry_focus_crops:
        variants = [
            prepare_crop(source_crop, min_size=260, threshold=135),
        ]
        if not FAST_MODE:
            variants.extend([
                prepare_crop(source_crop, min_size=260, threshold=None, denoise=True),
                prepare_crop(source_crop, min_size=280, threshold=160, denoise=True),
            ])

        for img in variants:
            txt = read_text(
                img,
                allowlist="0123456789????????????????????????????????????????????-/IL ",
                paragraph=False,
            )
            txt = clean_value(txt)
            if txt:
                txt = txt.replace("I68", "68").replace("L68", "68").replace("168", "68")
                all_candidates.append(txt)
                raw_reads.append(txt)

        merged = " ".join(raw_reads)
        fixed = canonical_document_type(merged)
        if fixed and is_strong_document_type(fixed):
            return fixed, all_candidates, [], [fixed]

    shape_candidates = detect_document_type_shapes(image)
    for item in shape_candidates:
        guessed, raw_from_shape = read_document_type_from_shape_crop(item["crop"], item["shapeType"])
        all_candidates.extend(raw_from_shape)
        if guessed:
            shape_votes.append(guessed)

    if shape_votes:
        return Counter(shape_votes).most_common(1)[0][0], all_candidates, shape_votes, text_votes

    return "", all_candidates, [], []


def read_issue_date(crop, layout_value="", fallback_crop=None):
    candidates = []

    if layout_value:
        fixed = normalize_date_value(layout_value)
        if fixed:
            return fixed, [layout_value]

    focus_crops = [
        crop,
        relative_subcrop(crop, 0.05, 0.00, 0.98, 1.00),
        relative_subcrop(crop, 0.00, 0.00, 1.00, 0.92),
    ]

    for source_crop in focus_crops:
        variants = [
            prepare_crop(source_crop, min_size=220, threshold=170),
            prepare_crop(source_crop, min_size=220, threshold=None, denoise=True),
            prepare_crop(source_crop, min_size=240, threshold=145),
        ]

        for img in variants:
            txt = read_text(img, allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©-/", paragraph=False)
            if txt:
                candidates.append(txt)
            fixed = normalize_date_value(txt)
            if fixed:
                return fixed, candidates

    if fallback_crop is not None and fallback_crop.size != 0:
        try:
            fallback_items = read_layout_items(fallback_crop)
            labeled_fields = extract_fields_by_labels(fallback_items)
            fallback_date = clean_value((labeled_fields or {}).get("issueDate", ""))
            if fallback_date:
                candidates.append(fallback_date)
                fixed = normalize_date_value(fallback_date)
                if fixed:
                    return fixed, candidates
        except Exception:
            pass

        for source_crop in build_focus_crops(fallback_crop, "warehouse"):
            img = prepare_crop(source_crop, min_size=320, threshold=None, denoise=True)
            txt = read_text(img, allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©-/: ", paragraph=True)
            if txt:
                candidates.append(txt)
            fixed = normalize_date_value(txt)
            if fixed:
                return fixed, candidates

    merged = clean_value(" ".join(candidates))
    fixed = normalize_date_value(merged)
    if fixed:
        return fixed, candidates

    return "", candidates


def read_document_number(crop):
    variants = [
        prepare_crop(crop, min_size=220, threshold=170),
        prepare_crop(crop, min_size=220, threshold=None, denoise=True),
    ]

    candidates = []
    votes = []

    for img in variants:
        txt = read_text(
            img,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
            paragraph=False,
        )
        txt = normalize_document_number(txt)
        if txt:
            candidates.append(txt)
            votes.append(txt)

    if votes:
        return Counter(votes).most_common(1)[0][0], candidates

    return "", candidates


def looks_like_real_warehouse(text=""):
    n = normalize_arabic(text)
    if not n:
        return False
    bad_parts = [
        "ط¨ط¯ظˆظ† ط§ط¬ظˆط±",
        "ط´ط±ظƒط© ط§ظ„طھظˆط²ظٹط¹",
        "ط§ظ„ظ‡ظٹط¦ط© ط§ظˆ ط§ظ„ظپط±ط¹",
        "ظپط±ط¹ ط§ظ„ط¨طµط±ط©",
        "ظپط±ط¹ ط§ظ„ط¨طµط±ظ‡",
        "ظپط±ط¹ ط§ظ„ظ†ط¬ظپ",
        "طھط§ط±ظٹط® ط§ظ„ط§طµط¯ط§ط±",
        "ط±ظ‚ظ… ط§ظ„ط³ظٹط§ط±ط©",
        "ظ…ط± ط§ظ„ط¨طµط±ظ‡",
        "ظ…ط± ط§ظ„ط¨طµط±ط©",
    ]
    if any(p in n for p in bad_parts):
        return False
    return "????????????" in n or "????????" in n or "??????????" in n


def extract_warehouse_candidates(text=""):
    raw = clean_value(text)
    if not raw:
        return []

    candidates = []

    for m in re.finditer(r"(ظ…ط³طھظˆط¯ط¹\s+[^\|\n\r]+)", raw):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(\u0645\u0635\u0641\u0649\s+[^\|\n\r]+)", raw):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(\u0645\u0635\u0641\u0627\u0629\s+[^\|\n\r]+)", raw):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(ظ…طµ[^\s\|\n\r]{1,4}\s+[^\|\n\r]+)", raw):
        candidates.append(clean_value(m.group(1)))

    normalized = normalize_arabic(raw)
    for m in re.finditer(r"(\u0645\u0633\u062a\u0648\u062f\u0639\s+[^\|\n\r]+)", normalized):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(\u0645\u0635\u0641\u0649\s+[^\|\n\r]+)", normalized):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(\u0645\u0635\u0641\u0627\u0629\s+[^\|\n\r]+)", normalized):
        candidates.append(clean_value(m.group(1)))
    for m in re.finditer(r"(ظ…طµ[^\s\|\n\r]{1,4}\s+[^\|\n\r]+)", normalized):
        candidates.append(clean_value(m.group(1)))

    if looks_like_real_warehouse(raw):
        candidates.append(raw)

    out = []
    seen = set()
    for c in candidates:
        key = normalize_arabic(c)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)

    return out


def score_warehouse_candidate(value=""):
    n = normalize_arabic(value)
    n = (
        n
        .replace("\u0645\u0635\u0646\u0649", "\u0645\u0635\u0641\u0649")
        .replace("\u0645\u0635\u0641\u064a", "\u0645\u0635\u0641\u0649")
        .replace("\u0627\u0644\u0633\u0645\u0627\u0648\u0647", "\u0627\u0644\u0633\u0645\u0627\u0648\u0629")
        .replace("\u0627\u0644\u0633\u0645\u0627\u0631\u0629", "\u0627\u0644\u0633\u0645\u0627\u0648\u0629")
    )
    score = 0.0

    if "\u0645\u0633\u062a\u0648\u062f\u0639" in n:
        score += 0.6
    if "\u0645\u0635\u0641\u0649" in n or "\u0645\u0635\u0641\u0627\u0629" in n:
        score += 0.55

    if any(x in n for x in [
        "\u0627\u0644\u0634\u0639\u064a\u0628\u0629",
        "\u0627\u0644\u0646\u062c\u0641",
        "\u0627\u0644\u062f\u0648\u0631\u0629",
        "\u0627\u0644\u062d\u0644\u0629",
        "\u0627\u0644\u0633\u0645\u0627\u0648\u0629",
        "\u0627\u0644\u0628\u0635\u0631\u0629",
        "\u0627\u0644\u0646\u0627\u0635\u0631\u064a\u0629",
    ]):
        score += 0.25

    if len(n.split()) <= 5:
        score += 0.1
    if "\u0641\u0631\u0639" in n and "\u0645\u0633\u062a\u0648\u062f\u0639" not in n:
        score -= 0.4
    if "\u0628\u062f\u0648\u0646 \u0627\u062c\u0648\u0631" in n:
        score -= 0.6

    return round(max(0.0, min(1.0, score)), 3)

def read_loading_warehouse(crop, layout_value="", fallback_crop=None):
    all_candidates = []

    if layout_value:
        all_candidates.extend(extract_warehouse_candidates(layout_value))
        if all_candidates:
            scored = []
            seen = set()
            for candidate in all_candidates:
                key = normalize_arabic(candidate)
                if not key or key in seen:
                    continue
                seen.add(key)
                scored.append({
                    "value": sanitize_warehouse_name(candidate),
                    "confidence": score_warehouse_candidate(candidate),
                })

            scored.sort(key=lambda x: (-x["confidence"], len(x["value"])))
            if scored and scored[0]["confidence"] >= 0.7:
                best = scored[0]["value"]
                raw_text = " | ".join([x["value"] for x in scored[:5]])
                return best, raw_text, scored[:5]

    primary_crops = build_focus_crops(crop, "warehouse")
    quick_crops = primary_crops[:1] or [crop]
    retry_crops = primary_crops[1:]
    if FAST_MODE:
        retry_crops = retry_crops[:1]

    def score_candidates(candidates):
        scored = []
        seen = set()
        for candidate in candidates:
            key = normalize_arabic(candidate)
            if not key or key in seen:
                continue
            seen.add(key)
            scored.append({
                "value": sanitize_warehouse_name(candidate),
                "confidence": score_warehouse_candidate(candidate),
            })
        scored.sort(key=lambda x: (-x["confidence"], len(x["value"])))
        best = scored[0]["value"] if scored else ""
        raw_text = " | ".join([x["value"] for x in scored[:5]])
        return best, raw_text, scored[:5]

    for source_crop in quick_crops:
        variants = [
            prepare_crop(source_crop, min_size=260, threshold=170),
            prepare_crop(source_crop, min_size=260, threshold=None, denoise=True),
        ]
        if FAST_MODE:
            variants = variants[:1]

        for img in variants:
            txt = read_text(img, paragraph=False)
            all_candidates.extend(extract_warehouse_candidates(txt))
            if txt and ("\u0645\u0635\u0641\u0649" in txt or "\u0645\u0635\u0641\u0627\u0629" in txt):
                all_candidates.append(clean_value(txt))

    best, raw_text, top_scored = score_candidates(all_candidates)
    if is_strong_warehouse_result(best, top_scored):
        return best, raw_text, top_scored

    for source_crop in retry_crops:
        variants = [
            prepare_crop(source_crop, min_size=260, threshold=170),
            prepare_crop(source_crop, min_size=260, threshold=None, denoise=True),
            prepare_crop(source_crop, min_size=280, threshold=185),
        ]
        if FAST_MODE:
            variants = variants[:1]

        for img in variants:
            txt = read_text(img, paragraph=False)
            all_candidates.extend(extract_warehouse_candidates(txt))
            if txt and ("\u0645\u0635\u0641\u0649" in txt or "\u0645\u0635\u0641\u0627\u0629" in txt):
                all_candidates.append(clean_value(txt))

    if fallback_crop is not None and fallback_crop.size != 0:
        focus_fallback_crops = build_focus_crops(fallback_crop, "warehouse")
        if FAST_MODE:
            focus_fallback_crops = focus_fallback_crops[:1]
        for source_crop in focus_fallback_crops:
            txt = read_text(
                prepare_crop(source_crop, min_size=320, threshold=None, denoise=True),
                paragraph=True
            )
            all_candidates.extend(extract_warehouse_candidates(txt))
            if txt:
                all_candidates.append(clean_value(txt))
            if txt and ("\u0645\u0635\u0641\u0649" in txt or "\u0645\u0635\u0641\u0627\u0629" in txt):
                all_candidates.append(clean_value(txt))

    best, raw_text, top_scored = score_candidates(all_candidates)
    return best, raw_text, top_scored


def score_product_type_candidate(value=""):
    text = clean_value(value)
    if not text:
        return 0.0

    normalized = normalize_arabic(text)
    score = 0.0
    if any(token in normalized for token in ["زيت", "الوقود", "بنزين", "اسفلت", "الاسفلت", "كيروسين", "نفط", "ديزل"]):
        score += 4.0
    if re.search(r"\b60\s*/\s*70\b", normalized):
        score += 3.0
    if re.search(r"\b\d{2}\s*/\s*\d{2}\b", normalized):
        score += 1.0
    if 3 <= len(normalized) <= 40:
        score += 1.0
    if re.search(r"\d{3,}", normalized):
        score -= 0.5
    return score


def read_product_type(crop, layout_value="", fallback_crop=None):
    candidates = []

    def push_candidate(txt):
        txt = clean_value(txt)
        if not txt:
            return
        candidates.append(txt)

    if layout_value:
        push_candidate(layout_value)
        layout_score = score_product_type_candidate(layout_value)
        if layout_score >= 2:
            return clean_value(layout_value), " | ".join(candidates), [{"value": clean_value(layout_value), "confidence": min(0.98, 0.5 + layout_score / 10)}]

    focused_crops = [
        crop,
        crop[:max(1, int(crop.shape[0] * 0.85)), :] if crop is not None and crop.size != 0 else crop,
    ]

    attempts = [
        (focused_crops[0], 260, 170, False, False),
        (focused_crops[0], 260, None, True, False),
        (focused_crops[1], 280, None, True, True),
    ]
    if FAST_MODE:
        attempts = attempts[:1]

    for source_crop, min_size, threshold, paragraph, denoise in attempts:
        if source_crop is None or source_crop.size == 0:
            continue
        img = prepare_crop(
            source_crop,
            min_size=min_size,
            threshold=threshold,
            denoise=denoise,
        )
        txt = read_text(img, paragraph=paragraph)
        if txt:
            push_candidate(txt)

    if fallback_crop is not None and fallback_crop.size != 0:
        for source_crop in build_focus_crops(fallback_crop, "warehouse")[:1]:
            img = prepare_crop(source_crop, min_size=280, threshold=None, denoise=True)
            txt = read_text(img, paragraph=True)
            if txt:
                push_candidate(txt)

    scored = []
    seen = set()
    for candidate in candidates:
        normalized = clean_value(candidate)
        key = normalize_arabic(normalized)
        if not key or key in seen:
            continue
        seen.add(key)
        scored.append({
            "value": normalized,
            "confidence": round(min(0.98, 0.45 + score_product_type_candidate(normalized) / 10), 3),
            "score": score_product_type_candidate(normalized),
        })

    scored.sort(key=lambda item: (-item["score"], -item["confidence"], -len(item["value"])))
    best = scored[0]["value"] if scored else ""
    return best, " | ".join(candidates), scored[:5]


def read_receiver_entity(crop, layout_value="", fallback_crop=None):
    candidates = []
    votes = []

    def add_candidate(txt):
        txt = clean_value(txt)
        if not txt:
            return False
        candidates.append(txt)
        fixed = extract_receiver_phrase(txt)
        score = receiver_phrase_score(fixed)
        if score >= 7:
            votes.append(CANONICAL_RECEIVER)
            return True
        if score >= 5:
            votes.append(fixed)
            return True
        return False

    if layout_value and add_candidate(layout_value):
        best = Counter(votes).most_common(1)[0][0]
        return best, candidates, True

    crop_h = max(crop.shape[0], 1)
    focused_crops = [
        crop[:max(1, int(crop_h * 0.45)), :],
        crop[:max(1, int(crop_h * 0.55)), :],
        crop[int(crop_h * 0.10):max(int(crop_h * 0.60), 1), :],
        crop,
    ]

    attempts = [
        (focused_crops[0], 300, None, False, False),
        (focused_crops[0], 300, None, True, False),
        (focused_crops[1], 320, None, True, False),
        (focused_crops[2], 320, None, True, True),
        (focused_crops[0], 300, 165, True, False),
    ]
    if FAST_MODE:
        attempts = attempts[:2]

    for source_crop, min_size, threshold, paragraph, denoise in attempts:
        if source_crop is None or source_crop.size == 0:
            continue
        img = prepare_crop(
            source_crop,
            min_size=min_size,
            threshold=threshold,
            denoise=denoise,
        )
        txt = read_text(img, paragraph=paragraph)
        if add_candidate(txt):
            best = Counter(votes).most_common(1)[0][0]
            return best, candidates, True

    if fallback_crop is not None and fallback_crop.size != 0:
        focus_fallback_crops = build_focus_crops(fallback_crop, "receiver")
        if FAST_MODE:
            focus_fallback_crops = focus_fallback_crops[:1]
        for source_crop in focus_fallback_crops:
            img = prepare_crop(source_crop, min_size=320, threshold=None, denoise=True)
            txt = read_text(img, paragraph=True)
            if add_candidate(txt):
                best = Counter(votes).most_common(1)[0][0]
                return best, candidates, True

    merged = clean_value(" ".join(candidates))
    fixed_merged = extract_receiver_phrase(merged)
    merged_score = receiver_phrase_score(fixed_merged)
    if merged_score >= 7:
        votes.append(CANONICAL_RECEIVER)
    elif merged_score >= 5:
        votes.append(fixed_merged)

    if votes:
        best = Counter(votes).most_common(1)[0][0]
        return best, candidates, True

    return fixed_merged or merged, candidates, False


def extract_quantity_value(crop, layout_value=""):
    raw_candidates = []

    if layout_value:
        raw_candidates.append(layout_value)
        v = extract_quantity_from_text(layout_value)
        if v:
            return v, raw_candidates

    variants = [
        prepare_crop(crop, min_size=250, threshold=180),
        prepare_crop(crop, min_size=250, threshold=150),
        prepare_crop(crop, min_size=250, threshold=None, denoise=True),
    ]
    if FAST_MODE:
        variants = variants[:1]

    numeric_candidates = []

    for img in variants:
        txt = read_text(
            img,
            allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©.",
            paragraph=False,
        )
        txt = clean_value(txt)
        if txt:
            raw_candidates.append(txt)

        western = to_western_digits(txt)
        numbers = re.findall(r"\d{3,6}", western)
        for n in numbers:
            value = int(n)
            if 1000 <= value <= 60000:
                numeric_candidates.append(value)

        if numeric_candidates:
            return max(numeric_candidates), raw_candidates

    merged = to_western_digits(" ".join(raw_candidates))
    numbers = re.findall(r"\d{3,6}", merged)
    filtered = [int(n) for n in numbers if 1000 <= int(n) <= 60000]
    if filtered:
        return max(filtered), raw_candidates

    return 0, raw_candidates


def read_vehicle_field(crop, layout_value=""):
    raw_candidates = []
    scored_parsed = []
    arabic_plate_votes = []

    def looks_like_vehicle_candidate(text):
        t = clean_value(to_western_digits(text)).upper()
        if not t:
            return False
        compact = re.sub(r"\s+", "", t)
        return bool(
            re.search(r"\d{4,6}/[0-9A-Z]{2,4}", compact)
            or re.search(r"[0-9A-Z]{2,4}/\d{4,6}", compact)
            or re.search(r"\d{2}[A-Z]\d{4,6}", compact)
            or re.search(r"[\u0621-\u064A]\s*\d{4,6}", text)
            or re.search(r"\d{4,6}\s*/\s*[\u0621-\u064A]", text)
            or re.search(r"\d{3,6}\s*/\s*[\u0600-\u06FF]{2,}", text)
        )

    def register_candidate(text, base_score=0):
        txt = clean_value(text)
        if not txt:
            return
        raw_candidates.append(txt)

        def push_plate_vote(digits="", letter="", score=0, governorate=""):
            digits = "".join(re.findall(r"\d", to_western_digits(digits or "")))
            digits = digits[-6:]
            if len(digits) < (3 if governorate else 4):
                return

            letter = normalize_arabic_plate_letter(letter)
            if not letter:
                return

            total_score = float(score)
            if letter == "أ":
                total_score += 10
            if letter in ("ف", "ق"):
                total_score -= 4
            if governorate:
                total_score += 8

            arabic_plate_votes.append({
                "digits": digits,
                "letter": letter,
                "governorate": clean_value(governorate),
                "score": total_score,
            })

        for m in re.finditer(r"(\d{3,4})\s+(\d)\s*/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF]+))?", txt):
            push_plate_vote(f"{m.group(2)}{m.group(1)}", m.group(3), base_score + 90, m.group(4) or "")

        for m in re.finditer(r"([\u0621-\u064A])\s+\d\s*/\s*(\d{4,6})(?:\s+([\u0600-\u06FF]+))?", txt):
            push_plate_vote(m.group(2), m.group(1), base_score + 80, m.group(3) or "")

        for m in re.finditer(r"([\u0621-\u064A])\s*(\d{4,6})(?:\s+([\u0600-\u06FF]+))?", txt):
            push_plate_vote(m.group(2), m.group(1), base_score + 55, m.group(3) or "")

        for m in re.finditer(r"(\d{4,6})\s*/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF]+))?", txt):
            push_plate_vote(m.group(1), m.group(2), base_score + 50, m.group(3) or "")

        parsed = parse_vehicle_field(txt)
        if not parsed.get("vehicleNumber"):
            return

        compact_src = re.sub(r"\s+", "", clean_value(to_western_digits(txt)).upper())
        score = float(base_score)
        parsed_number = clean_value(parsed.get("vehicleNumber", ""))
        parsed_digits = "".join(re.findall(r"\d", to_western_digits(parsed_number)))
        parsed_letter = normalize_arabic_plate_letter(parsed_number)
        parsed_governorate = clean_value(parsed.get("vehicleGovernorate", ""))

        # Prefer explicit formats like 12690/22E over noisy variants.
        if re.search(r"\d{4,6}/\d{2}[A-Z](?:\b|$)", compact_src) or re.search(r"\d{2}[A-Z]/\d{4,6}", compact_src):
            score += 100
        if re.search(r"\d{4,6}\s*/\s*[\u0621-\u064A](?:\s+[\u0600-\u06FF]+)?", txt):
            score += 120
        if parsed_letter and len(parsed_digits) >= (3 if parsed_governorate else 5):
            score += 80
        if parsed_governorate:
            score += 35
        if len(parsed_digits) < (3 if parsed_governorate else 4):
            score -= 200
        if parsed_number.isdigit():
            score -= 150
        if parsed_governorate and len(parsed_digits) == 3:
            score += 18
        if re.search(r"\d{3,6}\s*/\s*[\u0600-\u06FF]{2,}", txt):
            score += 26
        if re.search(r"/\d{3}(?:\b|$)", compact_src):
            score -= 25
        if re.search(r"[A-Z]", compact_src):
            score += 8
        if re.search(r"[\u0660-\u0669]", txt):
            score -= 8

        parsed_raw_compact = re.sub(
            r"\s+",
            "",
            clean_value(to_western_digits(parsed.get("vehicleNumberRaw", ""))).upper(),
        )
        if re.search(r"/\d{3}(?:\b|$)", parsed_raw_compact):
            score -= 10

        scored_parsed.append({
            "score": score,
            "parsed": parsed,
        })

    if layout_value:
        register_candidate(layout_value, base_score=60)

    # Read box items first, but do not return immediately; we rank all candidates.
    def pick_best_parsed():
        if not scored_parsed:
            return None

        best = sorted(
            scored_parsed,
            key=lambda x: (
                x["score"],
                len("".join(re.findall(r"\d", to_western_digits(x["parsed"].get("vehicleNumber", ""))))),
                1 if x["parsed"].get("vehicleGovernorate") else 0,
            ),
            reverse=True
        )[0]["parsed"]

        best_digits = "".join(re.findall(r"\d", to_western_digits(best.get("vehicleNumber", ""))))
        vote_pool = [item for item in arabic_plate_votes if item["digits"] == best_digits[-len(item["digits"]):]]
        if vote_pool:
            vote_pool.sort(
                key=lambda item: (
                    item["score"],
                    1 if item["letter"] == "أ" else 0,
                    1 if item["governorate"] else 0,
                ),
                reverse=True,
            )
            best_vote = vote_pool[0]
            best["vehicleNumber"] = f"{best_vote['letter']}{best_vote['digits']}"
            if best_vote["governorate"] and not best.get("vehicleGovernorate"):
                best["vehicleGovernorate"] = best_vote["governorate"]
        return best

    focus_crops = build_focus_crops(crop, "vehicle")
    quick_crops = focus_crops[:1] or [crop]
    retry_crops = focus_crops[1:]
    if FAST_MODE:
        retry_crops = retry_crops[:1]

    def run_vehicle_attempts(source_crops, include_heavy=False):
        for source_crop in source_crops:
            try:
                layout_items = read_layout_items(source_crop)
            except Exception:
                layout_items = []

            try:
                labeled_fields = extract_fields_by_labels(layout_items)
            except Exception:
                labeled_fields = {}
            labeled_vehicle = clean_value((labeled_fields or {}).get("vehicleNumber", ""))
            if labeled_vehicle:
                register_candidate(labeled_vehicle, base_score=95)

            seen_layout_texts = set()
            for item in sorted(layout_items, key=lambda x: float(x.get("confidence", 0)), reverse=True):
                txt = clean_value(item.get("text", ""))
                if not txt:
                    continue
                key = txt.lower()
                if key in seen_layout_texts:
                    continue
                seen_layout_texts.add(key)
                if "/" in txt or looks_like_vehicle_candidate(txt):
                    conf = float(item.get("confidence", 0))
                    register_candidate(txt, base_score=40 + (conf * 30))

            variants = [
                prepare_crop(source_crop, min_size=240, threshold=None),
                prepare_crop(source_crop, min_size=240, threshold=150),
            ]
            if include_heavy:
                variants.extend([
                    prepare_crop(source_crop, min_size=280, threshold=None, denoise=True),
                    prepare_crop(source_crop, min_size=300, threshold=170),
                ])

            for idx, img in enumerate(variants):
                variant_base = 30 - (idx * 3)
                reads = []

                txt1 = read_text(
                    img,
                    allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
                    paragraph=False,
                )
                if txt1:
                    reads.append((txt1, variant_base + 8))

                txt2 = read_text(
                    img,
                    allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
                    paragraph=True,
                )
                if txt2:
                    reads.append((txt2, variant_base + 3))

                if include_heavy:
                    txt3 = read_text(
                        img,
                        allowlist="0123456789ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzط§ط¨طھط«ط¬ط­ط®ط¯ط°ط±ط²ط³ط´طµط¶ط·ط¸ط¹ط؛ظپظ‚ظƒظ„ظ…ظ†ظ‡ظˆظٹظ‰ط¦ط¤ط©ط¢ط£ط¥ ",
                        paragraph=False,
                    )
                    if txt3:
                        reads.append((txt3, variant_base))

                for txt, score in reads:
                    register_candidate(txt, base_score=score)

            best = pick_best_parsed()
            if best and is_strong_vehicle_result(best):
                return best
        return pick_best_parsed()

    best = run_vehicle_attempts(quick_crops, include_heavy=False)
    if best and is_strong_vehicle_result(best):
        return " | ".join(raw_candidates), best

    best = run_vehicle_attempts(retry_crops, include_heavy=not FAST_MODE)
    if best:
        return " | ".join(raw_candidates), best

    merged = clean_value(" ".join(raw_candidates))
    register_candidate(merged, base_score=5)
    best = pick_best_parsed()
    if best:
        return " | ".join(raw_candidates), best

    return " | ".join(raw_candidates), {
        "vehicleNumberRaw": merged,
        "vehicleNumber": "",
        "vehicleGovernorate": "",
    }


def read_driver_name(crop, layout_value="", fallback_crop=None):
    raw_candidates = []
    cleaned_candidates = []

    def normalize_spaces(text):
        return re.sub(r"\s+", " ", clean_value(text)).strip()

    def repair_name_tokens(text):
        tokens = [t for t in normalize_spaces(text).split() if t]
        repaired = []
        token_alias_map = {
            "\u0639\u0628\u0627": "\u0639\u0628\u062f",
            "\u0639\u0628\u062f\u0647": "\u0639\u0628\u062f",
            "\u0628\u0639\u0644": "\u0628\u062f\u0631",
            "\u0641\u064a\u0639\u0644": "\u0641\u064a\u0635\u0644",
            "\u0641\u064a\u0636\u0644": "\u0641\u064a\u0635\u0644",
            "\u0641\u064a\u0635\u0644": "\u0641\u064a\u0635\u0644",
            "\u062c\u062a\u0642\u0631": "\u062c\u0639\u0641\u0631",
            "\u062c\u0639\u0642\u0631": "\u062c\u0639\u0641\u0631",
            "\u062c\u0639\u0641\u0631": "\u062c\u0639\u0641\u0631",
            "\u0627\u0644\u0634\u0628\u0643\u0649": "\u0627\u0644\u0634\u0628\u0643\u064a",
            "\u0627\u0644\u0634\u0628\u0643\u064a": "\u0627\u0644\u0634\u0628\u0643\u064a",
            "\u0635\u0630\u0627\u0621": "\u0635\u0641\u0627\u0621",
            "\u0635\u0641\u0627\u0621": "\u0635\u0641\u0627\u0621",
            "\u0645\u062d\u062b": "\u0645\u062d\u0645\u062f",
            "\u0645\u062d\u0645\u062f": "\u0645\u062d\u0645\u062f",
            "\u0627\u062d\u0645\u062f": "\u0623\u062d\u0645\u062f",
            "\u0627\u062d\u0645\u062f\u200f": "\u0623\u062d\u0645\u062f",
            "\u0643\u0627\u0641\u062a\u0645": "\u0643\u0627\u0638\u0645",
            "\u062f\u0627\u0638\u0645": "\u0643\u0627\u0638\u0645",
            "\u0630\u0627\u0638\u0638\u0645": "\u0643\u0627\u0638\u0645",
            "\u0643\u0627\u0638": "\u0643\u0627\u0638\u0645",
            "\u0643\u0627\u0636\u0645": "\u0643\u0627\u0638\u0645",
            "\u0634\u0649\u062f\u0631": "\u062e\u0636\u0631",
            "\u0634\u062f\u0631": "\u062e\u0636\u0631",
            "\u062b\u0649\u0630\u0631": "\u062e\u0636\u0631",
            "\u062e\u062f\u0631": "\u062e\u0636\u0631",
            "\u0645\u064a\u062a\u0627\u0642": "\u0645\u064a\u062b\u0627\u0642",
            "\u0645\u062a\u064a\u0627\u0642": "\u0645\u064a\u062b\u0627\u0642",
            "\u0645\u064a\u062a\u0627\u0639": "\u0645\u064a\u062b\u0627\u0642",
            "\u062d\u0628\u064a\u0646": "\u062d\u0646\u064a\u0646",
            "\u062c\u0628\u064a\u0646": "\u062d\u0646\u064a\u0646",
            "\u0639\u0632\u064a\u0631": "\u0639\u0632\u064a\u0632",
            "\u0627\u0644\u062c\u0627\u0633\u0645\u0649": "\u0627\u0644\u062c\u0627\u0633\u0645\u064a",
            "\u0627\u0644\u062c\u0627\u0633\u0645\u064a": "\u0627\u0644\u062c\u0627\u0633\u0645\u064a",
        }

        for idx, token in enumerate(tokens):
            fixed = token
            fixed = token_alias_map.get(fixed, fixed)
            if fixed == "\u0639\u0627\u0644\u0645" and idx + 1 < len(tokens) and tokens[idx + 1] == "\u0627\u0644\u0633\u0644\u0637\u0627\u0646":
                fixed = "\u0639\u0627\u062a\u0645"
            repaired.append(fixed)

        return " ".join(repaired)

    def score_name_candidate(value):
        parts = [p for p in normalize_spaces(value).split() if p]
        if len(parts) < 3:
            return -999

        score = (len(parts) * 2) + sum(min(len(p), 6) for p in parts)
        if len(parts[0]) <= 2:
            score -= 8
        score -= sum(3 for p in parts if len(p) <= 1)
        score -= max(0, len(parts) - 4) * 4
        if len(parts) >= 4 and len(parts[0]) >= 3:
            score += 5
        return score

    def add_layout_row_candidates():
        try:
            items = read_layout_items(crop)
        except Exception:
            items = []

        if not items:
            return

        rows = []
        sorted_items = sorted(items, key=lambda item: min(pt[1] for pt in item["bbox"]))

        for item in sorted_items:
            text = normalize_spaces(item.get("text", ""))
            if not text:
                continue

            y_top = min(pt[1] for pt in item["bbox"])
            y_bottom = max(pt[1] for pt in item["bbox"])
            x_right = max(pt[0] for pt in item["bbox"])

            assigned = False
            for row in rows:
                overlap = min(y_bottom, row["bottom"]) - max(y_top, row["top"])
                if overlap >= 0:
                    row["top"] = min(row["top"], y_top)
                    row["bottom"] = max(row["bottom"], y_bottom)
                    row["items"].append((x_right, text))
                    assigned = True
                    break

            if not assigned:
                rows.append({
                    "top": y_top,
                    "bottom": y_bottom,
                    "items": [(x_right, text)],
                })

        crop_h = max(crop.shape[0], 1)
        row_candidates = []
        blocked_tokens = {
            "\u062e\u0627\u0646\u0629",
            "\u0627\u0644\u0627\u0645",
            "\u0627\u0644\u0623\u0645",
            "\u0627\u0644\u0647\u0648\u064a\u0629",
            "\u0627\u0644\u0648\u0638\u064a\u0641\u064a",
            "\u0627\u0644\u062a\u0648\u0642\u064a\u0639",
            "\u0627\u0644\u062a\u0627\u0631\u064a\u062e",
        }

        for row in rows:
            row_text = normalize_spaces(
                " ".join(text for _, text in sorted(row["items"], key=lambda pair: pair[0], reverse=True))
            )
            if not row_text:
                continue

            cleaned = repair_name_tokens(sanitize_driver_name(row_text))
            cleaned = normalize_spaces(cleaned)
            parts = [p for p in cleaned.split() if p]
            if len(parts) < 3:
                continue
            if any(token in cleaned for token in blocked_tokens):
                continue
            if re.search(r"\d", cleaned):
                continue

            score = score_name_candidate(cleaned)
            if row["top"] <= crop_h * 0.55:
                score += 10
            if len(parts) <= 5:
                score += 6
            if len(parts) > 5:
                score -= (len(parts) - 5) * 6

            row_candidates.append((score, cleaned))

        row_candidates.sort(key=lambda pair: (-pair[0], len(pair[1])))
        for _, candidate in row_candidates[:3]:
            cleaned_candidates.append(candidate)

    def finalize_candidates():
        scored_unique_candidates = []
        seen = set()
        for c in cleaned_candidates:
            c = normalize_spaces(c)
            parts = [p for p in c.split() if p]
            if not c or len(parts) < 3 or c in seen:
                continue
            seen.add(c)
            scored_unique_candidates.append((score_name_candidate(c), c))

        scored_unique_candidates.sort(key=lambda item: (-item[0], -len(item[1].split()), -len(item[1])))
        unique_candidates = [candidate for _, candidate in scored_unique_candidates]

        best_name = unique_candidates[0] if unique_candidates else ""
        top_candidates = unique_candidates[:4]
        if len(top_candidates) >= 2:
            max_len = max(len(candidate.split()) for candidate in top_candidates)
            voted_parts = []
            for idx in range(max_len):
                votes = {}
                for rank, candidate in enumerate(top_candidates):
                    parts = candidate.split()
                    if idx >= len(parts):
                        continue
                    token = parts[idx]
                    votes[token] = votes.get(token, 0) + (len(top_candidates) - rank)
                if not votes:
                    continue
                winner = sorted(votes.items(), key=lambda item: (-item[1], -len(item[0])))[0][0]
                voted_parts.append(winner)

            voted_name = normalize_spaces(" ".join(voted_parts))
            if voted_name and score_name_candidate(voted_name) >= score_name_candidate(best_name):
                best_name = voted_name

        return " | ".join(raw_candidates), best_name

    def add_candidate(value):
        value = normalize_spaces(value)
        if not value:
            return

        raw_candidates.append(value)

        cleaned = sanitize_driver_name(value)
        cleaned = repair_name_tokens(cleaned)
        cleaned = re.sub(r"\d+", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned:
            cleaned_candidates.append(cleaned)

        for match in re.findall(r"[\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){2,5}", cleaned):
            candidate = normalize_spaces(match)
            if candidate:
                cleaned_candidates.append(candidate)

    if layout_value:
        add_candidate(layout_value)
        raw_text, best_name = finalize_candidates()
        if best_name:
            return raw_text, best_name

    add_layout_row_candidates()

    focused_crops = build_focus_crops(crop, "driver")
    quick_attempts = [
        (focused_crops[0], 250, None, False, False),
        (focused_crops[min(1, len(focused_crops) - 1)], 260, 165, False, False),
    ]
    retry_attempts = [
        (focused_crops[min(2, len(focused_crops) - 1)], 265, 155, False, False),
        (focused_crops[min(1, len(focused_crops) - 1)], 280, None, True, False),
        (focused_crops[-1], 285, None, True, True),
    ]
    if FAST_MODE:
        retry_attempts = retry_attempts[:1]

    for source_crop, min_size, threshold, paragraph, denoise in quick_attempts:
        img = prepare_crop(source_crop, min_size=min_size, threshold=threshold, denoise=denoise)
        rtl_txt = read_text_rtl(img)
        add_candidate(rtl_txt)
        txt = read_text(img, paragraph=paragraph)
        add_candidate(txt)
        raw_text, best_name = finalize_candidates()
        if best_name and is_strong_driver_result(best_name):
            return raw_text, best_name

    for source_crop, min_size, threshold, paragraph, denoise in retry_attempts:
        img = prepare_crop(source_crop, min_size=min_size, threshold=threshold, denoise=denoise)
        rtl_txt = read_text_rtl(img)
        add_candidate(rtl_txt)
        txt = read_text(img, paragraph=paragraph)
        add_candidate(txt)
        raw_text, best_name = finalize_candidates()
        if best_name and score_name_candidate(best_name) >= 24:
            return raw_text, best_name

    if fallback_crop is not None and fallback_crop.size != 0:
        focus_fallback_crops = build_focus_crops(fallback_crop, "driver")
        if FAST_MODE:
            focus_fallback_crops = focus_fallback_crops[:1]
        for source_crop in focus_fallback_crops:
            img = prepare_crop(source_crop, min_size=285, threshold=None, denoise=True)
            rtl_txt = read_text_rtl(img)
            add_candidate(rtl_txt)
            txt = read_text(img, paragraph=True)
            add_candidate(txt)
            raw_text, best_name = finalize_candidates()
            if best_name and score_name_candidate(best_name) >= 24:
                return raw_text, best_name

    return finalize_candidates()


def match_candidates_output(best_value="", raw_text="", candidates=None, warning="", governorate=""):
    candidates = candidates or []
    conf = candidates[0]["confidence"] if candidates else (1.0 if best_value else 0.0)
    out = {
        "raw": raw_text or best_value or "",
        "bestValue": best_value or "",
        "confidence": round(float(conf), 3),
        "warning": warning or "",
        "candidates": candidates,
    }
    if governorate:
        out["governorate"] = governorate
    return out


def parse_args():
    if len(sys.argv) < 2:
        raise ValueError("ظٹط±ط¬ظ‰ ط¥ط±ط³ط§ظ„ ظ…ط³ط§ط± ط§ظ„طµظˆط±ط©")

    image_path = sys.argv[1]
    template_name = DEFAULT_TEMPLATE_NAME
    debug_dir = ""

    if len(sys.argv) >= 3:
        template_name = sys.argv[2] or DEFAULT_TEMPLATE_NAME

    if len(sys.argv) >= 4:
        debug_dir = sys.argv[3] or ""

    return image_path, template_name, debug_dir


def extract_document(image_path, template_name=DEFAULT_TEMPLATE_NAME, debug_dir=""):
    global OCR_CACHE
    OCR_CACHE = {}

    total_started = now_ms()
    fields, template_data = load_template_fields(template_name)

    t0 = now_ms()
    image = preprocess_image(image_path)
    preprocess_duration_ms = now_ms() - t0

    layout_started = now_ms()
    layout_fields, layout_items = load_layout_fields(image, fields)
    layout_duration_ms = now_ms() - layout_started

    crops = {}
    for key, zone in fields.items():
        expand_x = 0.006
        expand_y = 0.005
        offset_x = 0.0
        offset_y = 0.0

        if key == "documentType":
            expand_x = 0.028
            expand_y = 0.028
            offset_x = 0.004
            offset_y = 0.002
        elif key == "documentNumber":
            expand_x = 0.012
            expand_y = 0.012
        elif key == "quantityLiters":
            expand_x = 0.010
            expand_y = 0.008
        elif key == "issueDate":
            expand_x = 0.005
            expand_y = 0.005
        elif key == "receiverEntity":
            expand_x = 0.030
            expand_y = 0.014
            offset_y = 0.006
        elif key == "driverName":
            expand_x = 0.008
            expand_y = 0.007
        elif key == "loadingWarehouseName":
            expand_x = 0.003
            expand_y = 0.003
            offset_y = 0.002
        elif key == "productType":
            expand_x = 0.014
            expand_y = 0.010
            offset_y = 0.003
        elif key == "vehicleField":
            expand_x = 0.020
            expand_y = 0.012
            offset_x = 0.002

        crops[key] = crop_relative(
            image,
            zone,
            expand_x=expand_x,
            expand_y=expand_y,
            offset_x=offset_x,
            offset_y=offset_y,
        )

        if debug_dir:
            Path(debug_dir).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(Path(debug_dir) / f"{key}.png"), crops[key])

    field_timers = {}

    t = now_ms()
    document_type, document_type_candidates, document_type_shape_votes, document_type_text_votes = read_document_type(image, fields, crops)
    field_timers["documentTypeMs"] = now_ms() - t

    document_number = ""
    document_number_candidates = []
    if "documentNumber" in crops:
        t = now_ms()
        document_number, document_number_candidates = read_document_number(crops["documentNumber"])
        field_timers["documentNumberMs"] = now_ms() - t

    issue_date = ""
    issue_date_candidates = []
    if "issueDate" in crops:
        t = now_ms()
        fallback_crop = crop_by_relative_box(image, 0.60, 0.108, 0.23, 0.055)
        issue_date, issue_date_candidates = read_issue_date(
            crops["issueDate"],
            layout_fields.get("issueDate", ""),
            fallback_crop=fallback_crop,
        )
        field_timers["issueDateMs"] = now_ms() - t

    warehouse_text = ""
    loading_warehouse_name = ""
    warehouse_candidates = []
    if "loadingWarehouseName" in crops:
        t = now_ms()

        fallback_crop = None
        if "loadingWarehouseName" in fields:
            fallback_crop = crop_by_relative_box(image, 0.60, 0.086, 0.21, 0.045)

        loading_warehouse_name, warehouse_text, warehouse_candidates = read_loading_warehouse(
            crops["loadingWarehouseName"],
            layout_fields.get("loadingWarehouseName", ""),
            fallback_crop=fallback_crop,
        )
        field_timers["loadingWarehouseMs"] = now_ms() - t

    product_type = ""
    product_type_text = ""
    product_type_candidates = []
    if "productType" in crops:
        t = now_ms()

        fallback_crop = None
        if "productType" in fields:
            fallback_crop = crop_by_relative_box(image, 0.33, 0.42, 0.23, 0.06)

        product_type, product_type_text, product_type_candidates = read_product_type(
            crops["productType"],
            layout_fields.get("productType", ""),
            fallback_crop=fallback_crop,
        )
        field_timers["productTypeMs"] = now_ms() - t

    receiver_text = ""
    receiver_entity = ""
    receiver_candidates = []
    receiver_entity_valid = False
    if "receiverEntity" in crops:
        t = now_ms()
        fallback_crop = crop_by_relative_box(image, 0.58, 0.132, 0.25, 0.045)
        receiver_entity, receiver_candidates, receiver_entity_valid = read_receiver_entity(
            crops["receiverEntity"],
            layout_fields.get("receiverEntity", ""),
            fallback_crop=fallback_crop,
        )
        receiver_text = " | ".join(receiver_candidates)
        field_timers["receiverEntityMs"] = now_ms() - t

    quantity_text = ""
    quantity_candidates = []
    supplied_quantity_liters = 0
    if "quantityLiters" in crops:
        t = now_ms()
        supplied_quantity_liters, quantity_candidates = extract_quantity_value(
            crops["quantityLiters"],
            layout_fields.get("quantityNatural", "")
        )
        quantity_text = " | ".join(quantity_candidates)
        field_timers["quantityLitersMs"] = now_ms() - t

    vehicle_text = ""
    vehicle_data = {
        "vehicleNumberRaw": "",
        "vehicleNumber": "",
        "vehicleGovernorate": "",
    }
    vehicle_candidates = []
    if "vehicleField" in crops:
        t = now_ms()
        vehicle_text, vehicle_data = read_vehicle_field(
            crops["vehicleField"],
            layout_fields.get("vehicleNumber", "")
        )

        print(json.dumps(json_safe({
            "debugVehicleFieldRaw": vehicle_text,
            "debugVehicleParsed": vehicle_data
        }), ensure_ascii=True), file=sys.stderr)

        if vehicle_data.get("vehicleNumber"):
            vehicle_candidates = [{
                "value": vehicle_data["vehicleNumber"],
                "confidence": 0.98,
            }]
        field_timers["vehicleFieldMs"] = now_ms() - t

    driver_text = ""
    driver_name = ""
    driver_candidates = []
    if "driverName" in crops:
        t = now_ms()
        fallback_crop = crop_by_relative_box(image, 0.16, 0.690, 0.26, 0.030)
        driver_text, driver_name = read_driver_name(
            crops["driverName"],
            layout_fields.get("driverName", ""),
            fallback_crop=fallback_crop,
        )

        if driver_name:
            driver_candidates = [{
                "value": driver_name,
                "confidence": 0.82,
            }]
        field_timers["driverNameMs"] = now_ms() - t

    total_duration_ms = now_ms() - total_started

    ocr_matches = {
        "loadingWarehouse": match_candidates_output(
            best_value=loading_warehouse_name,
            raw_text=warehouse_text,
            candidates=warehouse_candidates,
            warning="" if loading_warehouse_name else "???????? ?????????? ?????????? ??????????????",
        ),
        "productType": match_candidates_output(
            best_value=product_type,
            raw_text=product_type_text,
            candidates=product_type_candidates,
            warning="" if product_type else "???????? ?????????? ?????? ??????????????",
        ),
        "vehicle": match_candidates_output(
            best_value=vehicle_data["vehicleNumber"],
            raw_text=vehicle_text,
            candidates=vehicle_candidates,
            warning="" if vehicle_data["vehicleNumber"] else "???????? ?????????? ?????? ??????????????",
            governorate=vehicle_data["vehicleGovernorate"],
        ),
        "driver": match_candidates_output(
            best_value=driver_name,
            raw_text=driver_text,
            candidates=driver_candidates,
            warning="" if driver_name else "???????? ?????????? ?????? ????????????",
        ),
    }

    raw_text_parts = [
        " | ".join(document_type_candidates),
        " | ".join(document_number_candidates),
        " | ".join(issue_date_candidates),
        warehouse_text,
        receiver_text,
        product_type_text,
        quantity_text,
        vehicle_text,
        driver_text,
    ]
    raw_text = clean_value(" | ".join(part for part in raw_text_parts if clean_value(part)))

    return {
        "success": True,
        "templateName": template_name,
        "templateUpdatedAt": template_data.get("updatedAt"),
        "documentType": document_type,
        "documentNumber": document_number,
        "loadingWarehouseName": loading_warehouse_name,
        "issueDate": issue_date,
        "receiverEntity": receiver_entity,
        "receiverEntityValid": receiver_entity_valid,
        "receiverEntityWarning": "" if receiver_entity_valid else "?????????? ???????????? ?????????? ?????? ??????????",
        "vehicleNumberRaw": vehicle_data["vehicleNumberRaw"],
        "vehicleNumber": vehicle_data["vehicleNumber"],
        "vehicleGovernorate": vehicle_data["vehicleGovernorate"],
        "driverName": driver_name,
        "productType": product_type,
        "suppliedQuantityLiters": supplied_quantity_liters,
        "ocrMatches": ocr_matches,
        "rawText": raw_text,
        "meta": {
            "preprocessDurationMs": preprocess_duration_ms,
            "layoutDurationMs": layout_duration_ms,
            "pythonTotalDurationMs": total_duration_ms,
            **field_timers,
        },
        "debug": {
            "documentTypeCandidates": document_type_candidates,
            "documentTypeShapeVotes": document_type_shape_votes,
            "documentTypeTextVotes": document_type_text_votes,
            "documentNumberCandidates": document_number_candidates,
            "issueDateCandidates": issue_date_candidates,
            "warehouseText": warehouse_text,
            "warehouseCandidates": warehouse_candidates,
            "productTypeText": product_type_text,
            "productTypeCandidates": product_type_candidates,
            "receiverText": receiver_text,
            "receiverCandidates": receiver_candidates,
            "receiverEntityValid": receiver_entity_valid,
            "vehicleText": vehicle_text,
            "vehicleCandidates": vehicle_candidates,
            "driverText": driver_text,
            "driverCandidates": driver_candidates,
            "driverNameFinal": driver_name,
            "vehicleNumberFinal": vehicle_data["vehicleNumber"],
            "quantityText": quantity_text,
            "quantityCandidates": quantity_candidates,
            "rawText": raw_text,
            "templateFields": fields,
            "layoutFields": layout_fields,
            "layoutItemsCount": len(layout_items),
        },
    }


def run_worker():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = None
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            image_path = payload.get("imagePath")
            template_name = payload.get("templateName") or DEFAULT_TEMPLATE_NAME
            debug_dir = payload.get("debugDir") or ""
            result = extract_document(image_path, template_name, debug_dir)
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as exc:
            response = {
                "id": request_id,
                "ok": False,
                "error": {
                    "success": False,
                    "technicalError": True,
                    "message": str(exc),
                },
            }

        print(json.dumps(json_safe(response), ensure_ascii=True), flush=True)


def main():
    try:
        if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
            run_worker()
            return

        image_path, template_name, debug_dir = parse_args()
        data = extract_document(image_path, template_name, debug_dir)
        print(json.dumps(json_safe(data), ensure_ascii=True))
    except Exception as exc:
        print(json.dumps(json_safe({
            "success": False,
            "technicalError": True,
            "message": str(exc)
        }), ensure_ascii=True))
        sys.exit(1)


if __name__ == "__main__":
    main()

