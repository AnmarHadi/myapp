# -*- coding: utf-8 -*-
import os

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import sys
import json
import re
import tempfile
import warnings

from paddleocr import PaddleOCR


warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=UserWarning, module="requests")


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
            texts.extend([str(item).strip() for item in rec_texts if str(item).strip()])

        if isinstance(node.get("text"), str) and node["text"].strip():
            texts.append(node["text"].strip())

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
            texts.append(node[1][0].strip())
            return texts

        for item in node:
            texts.extend(_collect_texts(item))
        return texts

    return texts


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


OCR = build_ocr()


def to_western_digits(text: str) -> str:
    return str(text).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def read_text(image_path: str) -> str:
    prediction = OCR.predict(image_path)
    texts = _collect_texts(prediction)

    seen = set()
    unique = []
    for text in texts:
        text = text.strip()
        if text and text not in seen:
            seen.add(text)
            unique.append(text)

    return "\n".join(unique)


def extract_fields(text: str):
    text_upper = text.upper()

    doc_match = re.search(r"[A-Z]\d{8}", text_upper)
    document_number = doc_match.group(0) if doc_match else ""

    qty_match = re.search(r"\b\d{4,6}\b", to_western_digits(text))
    quantity = int(qty_match.group(0)) if qty_match else 0

    driver_match = re.search(r"اسم\s*السائق[:\-]?\s*([^\n]+)", text)
    driver = driver_match.group(1).strip() if driver_match else ""

    vehicle_match = re.search(r"(?:رقم\s*المركبة|السيارة)[:\-]?\s*([^\n]+)", text)
    vehicle = vehicle_match.group(1).strip() if vehicle_match else ""

    return {
        "documentNumber": document_number,
        "driverName": driver,
        "vehicleNumberRaw": vehicle,
        "suppliedQuantityLiters": quantity,
        "rawText": text,
        "success": True,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No input"}, ensure_ascii=False))
        sys.exit(1)

    image_path = sys.argv[1]

    try:
        text = read_text(image_path)
        data = extract_fields(text)
        print(json.dumps(data, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
