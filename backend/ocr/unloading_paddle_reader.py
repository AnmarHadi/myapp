# -*- coding: utf-8 -*-
import os

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import sys
import json
import re
import tempfile
import warnings
from pathlib import Path

import cv2
from paddleocr import PaddleOCR


warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=UserWarning, module="requests")


FIELD_CELLS = {
    "document_type": {"x": 0.262, "y": 0.123, "w": 0.050, "h": 0.050},
    "document_number": {"x": 0.300, "y": 0.175, "w": 0.200, "h": 0.060},
    "loading_warehouse_name": {"x": 0.430, "y": 0.107, "w": 0.240, "h": 0.030},
    "issue_date": {"x": 0.430, "y": 0.139, "w": 0.240, "h": 0.030},
    "receiver_entity": {"x": 0.430, "y": 0.170, "w": 0.250, "h": 0.048},
    "vehicle_field": {"x": 0.495, "y": 0.219, "w": 0.150, "h": 0.028},
    "quantity_liters": {"x": 0.470, "y": 0.197, "w": 0.090, "h": 0.028},
    "driver_name": {"x": 0.085, "y": 0.805, "w": 0.270, "h": 0.028},
}


def to_western_digits(text: str) -> str:
    table = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
    return str(text).translate(table)


def clean_value(text: str) -> str:
    if not text:
        return ""
    text = str(text)
    text = re.sub(r"^[\s:：\-–—|/\\.,;]+", "", text)
    text = re.sub(r"[\s:：\-–—|/\\.,;]+$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_arabic(text: str) -> str:
    text = to_western_digits(str(text))
    text = (
        text.replace("إ", "ا")
        .replace("أ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ة", "ه")
        .replace("ـ", "")
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_document_number(value: str) -> str:
    compact = re.sub(r"[^A-Z0-9]", "", to_western_digits(clean_value(value)).upper())
    match = re.match(r"^([A-Z])(\d{8})$", compact)
    return f"{match.group(1)}{match.group(2)}" if match else ""


def normalize_date_value(value: str) -> str:
    raw = clean_value(value)
    if not raw:
        return ""

    western = to_western_digits(raw).replace(".", "/")
    western = re.sub(r"\s+", "", western)
    western = re.sub(r"[^\d/-]", "", western)

    match = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$", western)
    if match:
        return f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}"

    match = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", western)
    if match:
        return f"{match.group(3)}-{match.group(2).zfill(2)}-{match.group(1).zfill(2)}"

    match = re.search(r"(20\d{2}).?(\d{1,2}).?(\d{1,2})", western)
    if match:
        return f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}"

    return ""


def sanitize_warehouse_name(value: str) -> str:
    value = clean_value(value)
    value = re.sub(r"^الجهة المجهزة\s*", "", value, flags=re.I)
    value = re.sub(r"^الجهه المجهزه\s*", "", value, flags=re.I)
    normalized = normalize_arabic(value)

    if "مستودع النجف الجديد" in normalized:
        return "مستودع النجف الجديد"
    if "مستودع الدوره الجديد" in normalized or "مستودع الدورة الجديد" in normalized:
        return "مستودع الدورة الجديد"

    return value


def canonical_receiver_entity(value: str) -> str:
    raw = clean_value(value)
    normalized = normalize_arabic(raw)

    if "مصفى النفط الذهبي" in normalized or "مصفاه النفط الذهبي" in normalized:
        return "معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد"

    return raw


def sanitize_driver_name(value: str) -> str:
    value = clean_value(value)
    value = re.sub(r"اسم\s*السائق", "", value, flags=re.I)
    value = re.sub(r"اسم\s*الام.*", "", value, flags=re.I)
    value = re.sub(r"رقم\s*الهويه.*", "", value, flags=re.I)
    value = re.sub(r"تاريخ\s*الهويه.*", "", value, flags=re.I)
    parts = [part for part in re.split(r"\s+", value) if part]

    cleaned = []
    for part in parts:
        normalized = normalize_arabic(part)
        western = to_western_digits(part)
        if re.fullmatch(r"\d+", western):
            continue
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", western):
            continue
        if "الام" in normalized or "الهويه" in normalized or "اسم" in normalized:
            continue
        cleaned.append(part)

    return clean_value(" ".join(cleaned[:6]))


def parse_vehicle_field(value: str):
    raw = clean_value(value)
    western = to_western_digits(raw)
    normalized = normalize_arabic(raw)

    governorate = ""
    for governorate_name in [
        "ديالى",
        "النجف",
        "بغداد",
        "البصرة",
        "نينوى",
        "أربيل",
        "اربيل",
        "الأنبار",
        "الانبار",
        "بابل",
        "ذي قار",
        "صلاح الدين",
        "كربلاء",
    ]:
        if normalize_arabic(governorate_name) in normalized:
            governorate = (
                governorate_name.replace("اربيل", "أربيل").replace("الانبار", "الأنبار")
            )
            break

    match = re.search(r"([\u0621-\u064A])\s*/?\s*(\d{3,8})", raw)
    if match:
        return {
            "vehicleNumber": f"{match.group(1)}{match.group(2)}",
            "vehicleGovernorate": governorate,
            "vehicleNumberRaw": raw,
        }

    compact = re.sub(r"\s+", "", western).upper()
    match = re.search(r"([A-Z0-9]{1,4})(\d{3,8})", compact)
    if match:
        return {
            "vehicleNumber": f"{match.group(1)}{match.group(2)}",
            "vehicleGovernorate": governorate,
            "vehicleNumberRaw": raw,
        }

    digits = re.search(r"(\d{3,8})", western)
    return {
        "vehicleNumber": digits.group(1) if digits else "",
        "vehicleGovernorate": governorate,
        "vehicleNumberRaw": raw,
    }


def preprocess_image(image_path: str):
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("تعذر قراءة الصورة")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    blurred = cv2.GaussianBlur(gray, (0, 0), 2.0)
    sharpened = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)

    height, width = sharpened.shape[:2]
    scale = 2200 / max(width, 1)
    new_width = int(width * scale)
    new_height = int(height * scale)
    resized = cv2.resize(sharpened, (new_width, new_height), interpolation=cv2.INTER_CUBIC)

    return resized


def crop_relative(image, zone):
    height, width = image.shape[:2]
    x = max(0, int(width * zone["x"]))
    y = max(0, int(height * zone["y"]))
    crop_width = max(3, int(width * zone["w"]))
    crop_height = max(3, int(height * zone["h"]))
    return image[y : y + crop_height, x : x + crop_width]


def _json_candidate(value):
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return None


def _collect_texts(node):
    texts = []

    json_value = _json_candidate(node)
    if json_value is not None and json_value is not node:
        return _collect_texts(json_value)

    if hasattr(node, "json"):
        return _collect_texts(getattr(node, "json"))

    if hasattr(node, "res"):
        return _collect_texts(getattr(node, "res"))

    if isinstance(node, dict):
        rec_texts = node.get("rec_texts")
        if isinstance(rec_texts, (list, tuple)):
            texts.extend([clean_value(item) for item in rec_texts if clean_value(item)])

        if isinstance(node.get("text"), str):
            text_value = clean_value(node.get("text"))
            if text_value:
                texts.append(text_value)

        for key, value in node.items():
            if key in {"rec_texts", "text"}:
                continue
            texts.extend(_collect_texts(value))
        return texts

    if isinstance(node, (list, tuple)):
        if (
            len(node) >= 2
            and isinstance(node[1], (list, tuple))
            and len(node[1]) >= 1
            and isinstance(node[1][0], str)
        ):
            text_value = clean_value(node[1][0])
            if text_value:
                texts.append(text_value)
            return texts

        for item in node:
            texts.extend(_collect_texts(item))
        return texts

    return texts


def _predict_texts(ocr, image_path: str):
    prediction = ocr.predict(image_path)
    texts = _collect_texts(prediction)

    seen = set()
    unique = []
    for text in texts:
        if text and text not in seen:
            seen.add(text)
            unique.append(text)

    return unique


def ocr_cell(ocr, cell_image, save_debug_path=None):
    if cell_image is None or cell_image.size == 0:
        return ""

    temp_path = None
    try:
        if save_debug_path:
            cv2.imwrite(save_debug_path, cell_image)
            temp_path = save_debug_path
        else:
            handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            temp_path = handle.name
            handle.close()
            cv2.imwrite(temp_path, cell_image)

        texts = _predict_texts(ocr, temp_path)
        return clean_value(" ".join(texts))
    finally:
        if temp_path and (not save_debug_path) and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def build_ocr():
    configs = [
        {
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_recognition_model_name": "arabic_PP-OCRv5_mobile_rec",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": "ar",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": "ar",
            "use_textline_orientation": False,
        },
        {
            "lang": "ar",
        },
    ]

    last_error = None
    for kwargs in configs:
        try:
            return PaddleOCR(**kwargs)
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"تعذر تهيئة PaddleOCR: {last_error}")


def main():
    if len(sys.argv) < 2:
        print(
            json.dumps({"success": False, "message": "يرجى إرسال مسار الصورة"}, ensure_ascii=False)
        )
        sys.exit(1)

    image_path = sys.argv[1]
    debug_dir = sys.argv[2] if len(sys.argv) > 2 else ""

    try:
        processed = preprocess_image(image_path)
        ocr = build_ocr()

        extracted = {}

        for field_name, zone in FIELD_CELLS.items():
            cell = crop_relative(processed, zone)
            debug_path = ""
            if debug_dir:
                Path(debug_dir).mkdir(parents=True, exist_ok=True)
                debug_path = str(Path(debug_dir) / f"{field_name}.png")
            extracted[field_name] = ocr_cell(ocr, cell, debug_path)

        vehicle_data = parse_vehicle_field(extracted["vehicle_field"])
        quantity_digits = re.sub(r"[^\d]", "", to_western_digits(extracted["quantity_liters"]))
        quantity_value = int(quantity_digits) if quantity_digits else 0

        data = {
            "documentNumber": normalize_document_number(extracted["document_number"]),
            "documentType": clean_value(extracted["document_type"]),
            "loadingWarehouseName": sanitize_warehouse_name(extracted["loading_warehouse_name"]),
            "issueDate": normalize_date_value(extracted["issue_date"]),
            "receiverEntity": canonical_receiver_entity(extracted["receiver_entity"]),
            "vehicleNumber": vehicle_data["vehicleNumber"],
            "vehicleGovernorate": vehicle_data["vehicleGovernorate"],
            "vehicleNumberRaw": vehicle_data["vehicleNumberRaw"],
            "driverName": sanitize_driver_name(extracted["driver_name"]),
            "suppliedQuantityLiters": quantity_value,
            "debug": extracted,
            "success": True,
        }

        print(json.dumps(data, ensure_ascii=False))
    except Exception as exc:
        print(
            json.dumps(
                {
                    "success": False,
                    "message": str(exc),
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
