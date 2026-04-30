# -*- coding: utf-8 -*-
import re


ALL_KNOWN_LABELS = [
    "تاريخ الاصدار",
    "تاريخ الإصدار",
    "الجهة المجهزة",
    "الجهة المجهزة للمنتوج",
    "الجهة المرسل اليها",
    "الجهة المرسل إليها",
    "رقم السيارة",
    "رقم المركبة",
    "رقم العجلة",
    "اسم السائق",
    "السائق",
    "اسم الام",
    "اسم الأم",
    "طبيعي لتر",
    "طبيعي (لتر)",
    "طبيعي",
    "طبيعى لتر",
]


def clean_text(value=""):
    return str(value or "").replace("\n", " ").replace("\r", " ").strip()


def normalize_arabic(value=""):
    return (
        clean_text(value)
        .replace("إ", "ا")
        .replace("أ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ة", "ه")
        .replace("ـ", "")
    )


def to_western_digits(value=""):
    return str(value).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def normalize_for_match(value=""):
    value = normalize_arabic(to_western_digits(clean_text(value)))
    value = re.sub(r"[^\u0600-\u06FF0-9\s:/\-\|]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def bbox_center(bbox):
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def bbox_bounds(bbox):
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return min(xs), min(ys), max(xs), max(ys)


def group_boxes_into_rows(ocr_items, y_tolerance=20):
    rows = []

    prepared = []
    for item in ocr_items:
        bbox = item.get("bbox")
        text = clean_text(item.get("text"))
        conf = float(item.get("confidence", 0))
        if not bbox or not text:
            continue

        _, cy = bbox_center(bbox)
        prepared.append({
            "bbox": bbox,
            "text": text,
            "confidence": conf,
            "cy": cy,
        })

    prepared.sort(key=lambda x: x["cy"])

    for item in prepared:
        placed = False
        for row in rows:
            if abs(row["avg_y"] - item["cy"]) <= y_tolerance:
                row["items"].append(item)
                row["avg_y"] = sum(i["cy"] for i in row["items"]) / len(row["items"])
                placed = True
                break

        if not placed:
            rows.append({
                "avg_y": item["cy"],
                "items": [item],
            })

    for row in rows:
        row["items"].sort(key=lambda i: bbox_bounds(i["bbox"])[0])
        row["text"] = " | ".join(i["text"] for i in row["items"])

    return rows


def row_match_score(row_text, label_variants):
    row_norm = normalize_for_match(row_text)
    score = 0
    for variant in label_variants:
        v = normalize_for_match(variant)
        if v and v in row_norm:
            score = max(score, len(v))
    return score


def find_label_in_rows(rows, label_variants):
    best_row = None
    best_score = -1

    for row in rows:
        score = row_match_score(row["text"], label_variants)
        if score > best_score:
            best_row = row
            best_score = score

    return best_row


def find_label_item(row, label_variants):
    if not row:
        return None, -1

    best_item = None
    best_idx = -1
    best_score = -1

    for idx, item in enumerate(row["items"]):
        score = row_match_score(item["text"], label_variants)
        if score > best_score:
            best_item = item
            best_idx = idx
            best_score = score

    return best_item, best_idx


def text_looks_like_any_known_label(text):
    t = normalize_for_match(text)
    for label in ALL_KNOWN_LABELS:
        if normalize_for_match(label) in t:
            return True
    return False


def strip_known_label_from_text(text, label_variants):
    """
    إذا كان العنوان والقيمة داخل نفس العنصر النصي، احذف العنوان وأرجع الباقي.
    مثال: "الجهة المجهزة مستودع الدورة الجديد" -> "مستودع الدورة الجديد"
    مثال: "55587/22A رقم السيارة" -> "55587/22A"
    """
    original = clean_text(text)
    norm = normalize_for_match(original)

    best = ""
    for label in label_variants:
        lv = normalize_for_match(label)
        if lv and lv in norm and len(lv) > len(best):
            best = lv

    if not best:
        return ""

    # حاول الحذف من النص الأصلي بصيغ متعددة
    patterns = []
    for label in label_variants:
        p = re.escape(clean_text(label))
        patterns.append(rf"^\s*{p}\s*[:：\-|]?\s*")
        patterns.append(rf"\s*[:：\-|]?\s*{p}\s*$")
        patterns.append(rf"{p}")

    cleaned = original
    for pattern in patterns:
        cleaned = re.sub(pattern, " ", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"\s+", " ", cleaned).strip(" |:-")
    return clean_text(cleaned)


def extract_neighbor_value(row, label_variants):
    if not row:
        return ""

    label_item, label_idx = find_label_item(row, label_variants)
    if label_idx < 0:
        return ""

    # 1) القيمة في نفس العنصر النصي
    same_item_value = strip_known_label_from_text(label_item["text"], label_variants)
    if same_item_value:
        return same_item_value

    items = row["items"]

    # 2) جرّب ما قبل العنوان
    left_parts = []
    for i in range(label_idx - 1, -1, -1):
        txt = clean_text(items[i]["text"])
        if not txt:
            continue
        if text_looks_like_any_known_label(txt):
            break
        left_parts.insert(0, txt)

    left_value = clean_text(" ".join(left_parts))

    # 3) جرّب ما بعد العنوان
    right_parts = []
    for i in range(label_idx + 1, len(items)):
        txt = clean_text(items[i]["text"])
        if not txt:
            continue
        if text_looks_like_any_known_label(txt):
            break
        right_parts.append(txt)

    right_value = clean_text(" ".join(right_parts))

    if left_value and right_value:
        return left_value
    if left_value:
        return left_value
    if right_value:
        return right_value
    return ""


def extract_value_from_next_row(rows, anchor_row, min_items=1):
    if not anchor_row:
        return ""

    try:
        idx = rows.index(anchor_row)
    except ValueError:
        return ""

    if idx + 1 >= len(rows):
        return ""

    next_row = rows[idx + 1]
    if len(next_row["items"]) < min_items:
        return ""

    txt = clean_text(" ".join(x["text"] for x in next_row["items"]))
    if text_looks_like_any_known_label(txt):
        return ""

    return txt


def extract_value_near_label(rows, label_variants):
    row = find_label_in_rows(rows, label_variants)
    if not row:
        return ""

    same_row = extract_neighbor_value(row, label_variants)
    if same_row:
        return same_row

    return extract_value_from_next_row(rows, row)


def extract_loading_warehouse(rows):
    return extract_value_near_label(
        rows,
        ["الجهة المجهزة", "الجهة المجهزة للمنتوج", "الجهه المجهزه"]
    )


def extract_product_type(rows):
    return extract_value_near_label(
        rows,
        ["نوع المنتوج", "نوع المنتج"]
    )


def extract_vehicle_by_label(rows):
    row = find_label_in_rows(rows, ["رقم السيارة", "رقم المركبة", "رقم العجلة"])
    if not row:
        return ""

    row_text = clean_text(row["text"])
    norm = normalize_for_match(row_text)

    # 1) صيغة: 55587/22A رقم السيارة
    m = re.search(r'([A-Za-z\u0621-\u064A]?\d{1,6}(?:/\d{1,6}[A-Za-z\u0621-\u064A]?)?)\s*(?:رقم السيارة|رقم المركبة|رقم العجلة)', row_text, re.IGNORECASE)
    if m:
        return clean_text(m.group(1))

    # 2) صيغة: رقم السيارة 55587/22A
    m = re.search(r'(?:رقم السيارة|رقم المركبة|رقم العجلة)\s*[:：\-|]?\s*([A-Za-z\u0621-\u064A]?\d{1,6}(?:/\d{1,6}[A-Za-z\u0621-\u064A]?)?)', row_text, re.IGNORECASE)
    if m:
        return clean_text(m.group(1))

    # 3) fallback منطق الجار
    value = extract_neighbor_value(row, ["رقم السيارة", "رقم المركبة", "رقم العجلة"])
    if value:
        return value

    # 4) آخر fallback: خذ الصف كله، وسيتم تحليله لاحقًا
    return row_text


def extract_driver_name_by_label(rows):
    # 1) ابحث عن صف يبدأ أو يحتوي "السائق"
    for row in rows:
        row_text = clean_text(row["text"])
        if "السائق" in row_text:
            m = re.search(r'السائق\s*[:：\-|]?\s*(.+)$', row_text)
            if m:
                return clean_text(m.group(1))
            return row_text

    # 2) fallback لصف "اسم السائق"
    row = find_label_in_rows(rows, ["اسم السائق"])
    if row:
        value = extract_neighbor_value(row, ["اسم السائق"])
        if value:
            return value

    return ""


def extract_quantity_by_label(rows, label_variants):
    raw = extract_value_near_label(rows, label_variants)
    if raw:
        return raw

    row = find_label_in_rows(rows, label_variants)
    if not row:
        return ""

    try:
        idx = rows.index(row)
    except ValueError:
        return ""

    collected = []
    for next_idx in range(idx, min(idx + 3, len(rows))):
        collected.append(rows[next_idx]["text"])

    return clean_text(" ".join(collected))


def extract_fields_by_labels(ocr_items):
    rows = group_boxes_into_rows(ocr_items)

    result = {
        "issueDate": "",
        "loadingWarehouseName": "",
        "receiverEntity": "",
        "vehicleNumber": "",
        "productType": "",
        "driverName": "",
        "quantityNatural": "",
        "debugRows": rows,
    }

    result["issueDate"] = extract_value_near_label(rows, ["تاريخ الاصدار", "تاريخ الإصدار"])
    result["loadingWarehouseName"] = extract_loading_warehouse(rows)
    result["receiverEntity"] = extract_value_near_label(
        rows,
        ["الجهة المرسل اليها", "الجهة المرسل إليها", "الجهه المرسل اليها"]
    )
    result["vehicleNumber"] = extract_vehicle_by_label(rows)
    result["productType"] = extract_product_type(rows)
    result["driverName"] = extract_driver_name_by_label(rows)
    result["quantityNatural"] = extract_quantity_by_label(
        rows,
        ["طبيعي لتر", "طبيعي (لتر)", "طبيعي", "طبيعى لتر"]
    )

    return result
