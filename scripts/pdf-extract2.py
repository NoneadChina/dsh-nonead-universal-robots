"""Offline PDF text extraction for the UR script manuals (stdlib only).

The PolyScope 5 / PolyScope X manuals embed subset fonts declared as ``/Type0`` with
``/Encoding /Identity-H``: the character codes in their content streams are **glyph ids**, so
the text can only be recovered through the ``/ToUnicode`` CMap each font carries. The 3.15
manual instead uses plain WinAnsi Type1 fonts, where the byte *is* the character code. This
script handles both, plus a TrueType ``cmap`` fallback for the odd font that has neither.

This is a development tool, not part of the shipped plugin: it exists so that every signature,
default and range quoted by the plugin — and in ``docs/urscript-manual-analysis.md`` — can be
re-derived from the bundled manuals instead of being taken on trust.

Run ``python scripts/pdf-extract2.py ScriptManual`` (or point it at any directory of PDFs).
Output: one text file per PDF in ``ScriptManual/txt/``, pages separated by a form feed.
"""
from __future__ import annotations

import os
import re
import struct
import sys
import zlib

# --------------------------------------------------------------------------
# PDF object model (enough for the manuals)
# --------------------------------------------------------------------------

OBJ_RE = re.compile(rb"(?m)^\s*(\d+)\s+(\d+)\s+obj\b")
STREAM_RE = re.compile(rb"stream\r?\n")


def decode_stream(body: bytes, dict_src: bytes) -> bytes | None:
    if b"/FlateDecode" in dict_src:
        try:
            return zlib.decompress(body)
        except Exception:
            try:
                return zlib.decompressobj().decompress(body)
            except Exception:
                return None
    if b"/FlateDecode" not in dict_src and b"/Filter" not in dict_src:
        return body
    return None


class Pdf:
    def __init__(self, path: str):
        with open(path, "rb") as fh:
            self.data = fh.read()
        self.objects: dict[int, bytes] = {}
        self.streams: dict[int, bytes] = {}
        self._scan_objects()
        self._expand_object_streams()

    def _scan_objects(self) -> None:
        data = self.data
        for m in OBJ_RE.finditer(data):
            num = int(m.group(1))
            start = m.end()
            end = data.find(b"endobj", start)
            if end < 0:
                continue
            chunk = data[start:end]
            sm = STREAM_RE.search(chunk)
            if sm:
                header = chunk[: sm.start()]
                body = chunk[sm.end() :]
                body = re.sub(rb"\s*endstream\s*$", b"", body)
                self.objects[num] = header
                decoded = decode_stream(body, header)
                if decoded is not None:
                    self.streams[num] = decoded
            else:
                self.objects[num] = chunk

    def _expand_object_streams(self) -> None:
        for num, header in list(self.objects.items()):
            if b"/ObjStm" not in header or num not in self.streams:
                continue
            blob = self.streams[num]
            n = int(re.search(rb"/N\s+(\d+)", header).group(1))
            first = int(re.search(rb"/First\s+(\d+)", header).group(1))
            head = blob[:first].split()
            pairs = [(int(head[2 * i]), int(head[2 * i + 1])) for i in range(n)]
            for i, (objnum, off) in enumerate(pairs):
                end = pairs[i + 1][1] + first if i + 1 < len(pairs) else len(blob)
                self.objects.setdefault(objnum, blob[first + off : end])

    def get(self, num: int) -> bytes:
        return self.objects.get(num, b"")


# --------------------------------------------------------------------------
# TrueType cmap
# --------------------------------------------------------------------------


def ttf_gid_to_char(ttf: bytes) -> dict[int, int]:
    """Return {glyph id -> unicode code point} from a TrueType/OpenType file."""
    if ttf[:4] == b"ttcf":
        off0 = struct.unpack_from(">I", ttf, 12)[0]
        ttf = ttf[off0:]
    if len(ttf) < 12:
        return {}
    num_tables = struct.unpack_from(">H", ttf, 4)[0]
    tables: dict[str, tuple[int, int]] = {}
    for i in range(num_tables):
        off = 12 + 16 * i
        if off + 16 > len(ttf):
            break
        tag = ttf[off : off + 4].decode("latin-1")
        toff, tlen = struct.unpack_from(">II", ttf, off + 8)
        tables[tag] = (toff, tlen)
    if "cmap" not in tables:
        return {}
    base = tables["cmap"][0]
    if base + 4 > len(ttf):
        return {}
    n = struct.unpack_from(">H", ttf, base + 2)[0]
    subtables = []
    for i in range(n):
        try:
            pid, eid, off = struct.unpack_from(">HHI", ttf, base + 4 + 8 * i)
        except struct.error:
            break
        subtables.append((pid, eid, base + off))

    def rank(t):
        pid, eid, _ = t
        if (pid, eid) == (3, 10):
            return 0
        if (pid, eid) == (3, 1):
            return 1
        if pid == 0:
            return 2
        return 3

    reverse: dict[int, int] = {}
    for pid, eid, off in sorted(subtables, key=rank):
        if off + 4 > len(ttf):
            continue
        fmt = struct.unpack_from(">H", ttf, off)[0]
        code_to_gid: dict[int, int] = {}
        if fmt == 4:
            seg_x2 = struct.unpack_from(">H", ttf, off + 6)[0]
            seg = seg_x2 // 2
            if off + 16 + 3 * seg_x2 > len(ttf):
                continue
            try:
                ends = struct.unpack_from(f">{seg}H", ttf, off + 14)
                starts = struct.unpack_from(f">{seg}H", ttf, off + 16 + seg_x2)
                deltas = struct.unpack_from(f">{seg}h", ttf, off + 16 + 2 * seg_x2)
                range_off_pos = off + 16 + 3 * seg_x2
                ranges = struct.unpack_from(f">{seg}H", ttf, range_off_pos)
            except struct.error:
                continue
            for i in range(seg):
                for c in range(starts[i], min(ends[i], 0xFFFF) + 1):
                    if ranges[i] == 0:
                        g = (c + deltas[i]) & 0xFFFF
                    else:
                        gp = range_off_pos + 2 * i + ranges[i] + 2 * (c - starts[i])
                        if gp + 2 > len(ttf):
                            continue
                        g = struct.unpack_from(">H", ttf, gp)[0]
                        if g:
                            g = (g + deltas[i]) & 0xFFFF
                    if g:
                        code_to_gid[c] = g
        elif fmt == 12:
            try:
                ngroups = struct.unpack_from(">I", ttf, off + 12)[0]
            except struct.error:
                continue
            for i in range(ngroups):
                try:
                    s, e, gid = struct.unpack_from(">III", ttf, off + 16 + 12 * i)
                except struct.error:
                    break
                for c in range(s, e + 1):
                    code_to_gid[c] = gid + (c - s)
        elif fmt == 6:
            try:
                first, count = struct.unpack_from(">HH", ttf, off + 6)
                gids = struct.unpack_from(f">{count}H", ttf, off + 10)
            except struct.error:
                continue
            for i, g in enumerate(gids):
                if g:
                    code_to_gid[first + i] = g
        if code_to_gid:
            for code, gid in code_to_gid.items():
                reverse.setdefault(gid, code)
            return reverse
    return reverse


# --------------------------------------------------------------------------
# content stream text extraction
# --------------------------------------------------------------------------

TOKEN_RE = re.compile(
    rb"/(?P<name>[^\s/\[\]<>(){}]+)"
    rb"|(?P<str>\((?:[^()\\]|\\.)*\))"
    rb"|(?P<hex><[0-9A-Fa-f\s]*>)"
    rb"|(?P<num>[-+]?\d*\.?\d+)"
    rb"|(?P<arr>[\[\]])"
    rb"|(?P<op>[A-Za-z'\"*][A-Za-z0-9'\"*]*)"
)

SPACE_KERN = 100.0
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
# A horizontal gap wider than this fraction of the font size is treated as a
# word break.  Calibrated against these manuals: it sits between the widest
# intra-word gap (tabular figures / italic correction) and the narrowest
# real space, so it neither invents nor drops spaces.
GAP_FACTOR = float(os.environ.get("PDF_GAP_FACTOR", "0.42"))
ESC = {
    ord("n"): "\n",
    ord("r"): "\r",
    ord("t"): "\t",
    ord("b"): "",
    ord("f"): "",
    ord("("): "(",
    ord(")"): ")",
    ord("\\"): "\\",
}


def unescape_pdf(raw: bytes) -> bytes:
    out = bytearray()
    i = 0
    n = len(raw)
    while i < n:
        b = raw[i]
        if b == 0x5C and i + 1 < n:
            nxt = raw[i + 1]
            if nxt in ESC:
                out += ESC[nxt].encode("latin-1")
                i += 2
            elif 0x30 <= nxt <= 0x37:
                j = i + 1
                oct_digits = b""
                while j < n and len(oct_digits) < 3 and 0x30 <= raw[j] <= 0x37:
                    oct_digits += raw[j : j + 1]
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
            else:
                out.append(nxt)
                i += 2
        else:
            out.append(b)
            i += 1
    return bytes(out)


def decode_with(mapping: dict[int, str], raw: bytes, width: int = 1) -> str:
    if not mapping:
        if width == 2:
            return "".join(chr(int.from_bytes(raw[i : i + 2], "big")) for i in range(0, len(raw) - 1, 2))
        return raw.decode("latin-1")
    out = []
    step = 2 if width == 2 else 1
    for i in range(0, len(raw), step):
        chunk = raw[i : i + step]
        if len(chunk) < step:
            break
        code = int.from_bytes(chunk, "big")
        text = mapping.get(code)
        if text is None:
            out.append("\ufffd" if width == 1 else "")
        else:
            out.append(text)
    return "".join(out)


def text_items(content: bytes, font_maps: dict[str, tuple[dict[int, str], int, float]]):
    """Extract (x, y, text, font size, rotation) runs from one content stream."""
    items: list[tuple[float, float, str, float, float]] = []
    stack: list[float] = []
    pending: list[str] = []
    mapping: dict[int, str] = {}
    width = 1
    font_size = 10.0
    last_name: str | None = None
    x = y = 0.0
    skew = 0.0
    array_depth = 0

    def flush() -> None:
        if pending:
            items.append((x, y, "".join(pending), font_size, skew))
        pending.clear()

    for m in TOKEN_RE.finditer(content):
        kind = m.lastgroup
        if kind == "name":
            flush()
            stack.clear()
            last_name = m.group("name").decode("latin-1")
            continue
        if kind == "str":
            raw = unescape_pdf(m.group("str")[1:-1])
            pending.append(decode_with(mapping, raw, width))
        elif kind == "hex":
            digits = re.sub(rb"\s", b"", m.group("hex")[1:-1])
            if len(digits) % 2:
                digits += b"0"
            pending.append(decode_with(mapping, bytes.fromhex(digits.decode("latin-1")), width))
        elif kind == "num":
            value = float(m.group("num"))
            if array_depth and pending and value <= -max(80.0, 0.25 * font_size):
                pending.append(" ")
            stack.append(value)
            if len(stack) > 8:
                del stack[:-8]
        elif kind == "arr":
            stack.clear()
            if m.group("arr") == b"[":
                array_depth += 1
                pending.clear()
            else:
                array_depth = max(0, array_depth - 1)
        elif kind == "op":
            op = m.group("op")
            if op == b"Tf":
                flush()
                entry = font_maps.get(last_name) if last_name is not None else None
                if entry:
                    mapping, width, _space = entry
                else:
                    mapping, width = {}, 1
                if stack:
                    font_size = stack[-1] or font_size
            elif op in (b"Td", b"TD"):
                flush()
                if len(stack) >= 2:
                    x += stack[-2]
                    y += stack[-1]
            elif op == b"Tm":
                flush()
                if len(stack) >= 6:
                    # The text matrix is [a b c d e f]; a non-zero `b` means the
                    # run is rotated (UR manuals stamp a rotated copyright
                    # watermark across every page, which must not be mixed into
                    # the body text).
                    a, b, _c, _d, e, f = stack[-6:]
                    x, y = e, f
                    skew = abs(b) / max(abs(a), 1e-6)
            elif op in (b"Tj", b"'", b'"', b"TJ"):
                flush()
            elif op == b"BT":
                x = y = 0.0
            stack.clear()
    flush()
    return items


# --------------------------------------------------------------------------
# page walking
# --------------------------------------------------------------------------


def find_pages(pdf: Pdf) -> list[tuple[int, bytes]]:
    """Return [(page object number, page dict)] in object order, best effort."""
    page_nums = []
    for num, body in pdf.objects.items():
        if re.search(rb"/Type\s*/Page[^s]", body):
            page_nums.append(num)
    return [(num, pdf.get(num)) for num in sorted(page_nums)]


def balanced_dict(data: bytes, start: int, opener: int = 0x3C, closer: int = 0x3E) -> bytes:
    """Return the `<<...>>` (or `[...]`) slice starting at `start`, nesting-aware."""
    depth = 0
    i = start
    n = len(data)
    while i < n:
        b = data[i]
        if b == opener:
            depth += 1
        elif b == closer:
            depth -= 1
            if depth == 0:
                return data[start : i + 1]
        elif b == 0x28:  # '(' string literal
            i += 1
            while i < n and data[i] != 0x29:
                if data[i] == 0x5C:
                    i += 1
                i += 1
        i += 1
    return data[start:]


def dict_value(data: bytes, key: bytes, opener: int = 0x3C, closer: int = 0x3E) -> bytes | None:
    """Value of ``/key`` in a PDF dictionary, handling inline dicts and refs."""
    m = re.search(rb"/" + key + rb"\s*", data)
    if not m:
        return None
    rest = data[m.end() :]
    if rest.startswith(b"<<"):
        return balanced_dict(rest, 0)
    if rest.startswith(b"["):
        return balanced_dict(rest, 0, 0x5B, 0x5D)
    return rest


def resolve_ref(pdf: "Pdf", value: bytes) -> bytes:
    m = re.match(rb"\s*(\d+)\s+\d+\s+R", value)
    return pdf.get(int(m.group(1))) if m else value


def parse_to_unicode(cmap: bytes) -> dict[int, str]:
    """Parse a PDF ToUnicode CMap into {code -> replacement text}.

    Values may be multi-character (ligatures such as ``ffi``), which is why the
    map holds strings rather than code points.
    """
    out: dict[int, str] = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", cmap, re.S):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            code = int(src, 16)
            out[code] = hex_to_text(dst)
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", cmap, re.S):
        # <lo> <hi> <dst>  |  <lo> <hi> [<d1> <d2> ...]
        for m in re.finditer(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])",
            block,
            re.S,
        ):
            lo = int(m.group(1), 16)
            hi = int(m.group(2), 16)
            target = m.group(3)
            if target.startswith(b"["):
                for i, item in enumerate(re.findall(rb"<([0-9A-Fa-f]*)>", target)):
                    if lo + i > hi:
                        break
                    out[lo + i] = hex_to_text(item)
            else:
                base = hex_to_text(target[1:-1])
                for i in range(hi - lo + 1):
                    if not base:
                        continue
                    # increment the last code unit of the destination
                    chars = list(base)
                    chars[-1] = chr(ord(chars[-1]) + i)
                    out[lo + i] = "".join(chars)
    return out


def hex_to_text(hexdigits: bytes) -> str:
    if not hexdigits:
        return ""
    text = hexdigits.decode("latin-1")
    if len(text) % 4 == 0:
        units = [int(text[i : i + 4], 16) for i in range(0, len(text), 4)]
    elif len(text) % 2 == 0:
        units = [int(text[i : i + 2], 16) for i in range(0, len(text), 2)]
    else:
        return ""
    try:
        return "".join(chr(u) for u in units)
    except ValueError:
        return ""


def ttf_char_to_gid(ttf: bytes) -> dict[int, int]:
    """Inverse of `ttf_gid_to_char` (code point -> glyph id)."""
    return {code: gid for gid, code in ttf_gid_to_char(ttf).items()}


def ttf_advance_widths(ttf: bytes) -> tuple[list[int], int]:
    """Return (advance widths by glyph id, units per em) for hmtx/hhea."""
    if ttf[:4] == b"ttcf":
        off0 = struct.unpack_from(">I", ttf, 12)[0]
        ttf = ttf[off0:]
    if len(ttf) < 12:
        return [], 1000
    num_tables = struct.unpack_from(">H", ttf, 4)[0]
    tables: dict[str, tuple[int, int]] = {}
    for i in range(num_tables):
        off = 12 + 16 * i
        if off + 16 > len(ttf):
            break
        tables[ttf[off : off + 4].decode("latin-1")] = struct.unpack_from(">II", ttf, off + 8)
    if "hmtx" not in tables or "hhea" not in tables or "head" not in tables:
        return [], 1000
    upem = struct.unpack_from(">H", ttf, tables["head"][0] + 18)[0] or 1000
    num_h = struct.unpack_from(">H", ttf, tables["hhea"][0] + 34)[0]
    hmtx = tables["hmtx"][0]
    available = min(num_h, max(0, (tables["hmtx"][1]) // 2))
    if available <= 0:
        return [], upem
    return list(struct.unpack_from(f">{available}H", ttf, hmtx)), upem


def find_space_width(pdf: "Pdf", fbody: bytes) -> float:
    """Space advance width of a font, as a fraction of the em square."""
    desc = re.search(rb"/FontDescriptor\s+(\d+)\s+\d+\s+R", fbody)
    if not desc:
        return 0.28
    dbody = pdf.get(int(desc.group(1)))
    ff = re.search(rb"/FontFile2\s+(\d+)\s+\d+\s+R", dbody)
    if not ff:
        return 0.28
    ttf = pdf.streams.get(int(ff.group(1)))
    if not ttf:
        return 0.28
    widths, upem = ttf_advance_widths(ttf)
    if not widths:
        return 0.28
    gid = ttf_char_to_gid(ttf).get(0x20)
    if gid is None or gid >= len(widths):
        return 0.28
    return widths[gid] / upem


def resource_fonts(pdf: Pdf, resources: bytes) -> dict[str, tuple[dict[int, str], int, float]]:
    """Map each font resource name to (code -> text, bytes per code, space width)."""
    out: dict[str, tuple[dict[int, str], int, float]] = {}
    fonts_raw = dict_value(resources, b"Font")
    if fonts_raw is None:
        return out
    font_dict = resolve_ref(pdf, fonts_raw)
    for m in re.finditer(rb"/(\w+)\s+(\d+)\s+\d+\s+R", font_dict):
        name = m.group(1).decode("latin-1")
        fbody = pdf.get(int(m.group(2)))
        mapping: dict[int, str] = {}
        tu = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", fbody)
        if tu:
            cmap = pdf.streams.get(int(tu.group(1)))
            if cmap:
                mapping = parse_to_unicode(cmap)
        if not mapping:
            # simple font: decode through the embedded TrueType cmap
            desc = re.search(rb"/FontDescriptor\s+(\d+)\s+\d+\s+R", fbody)
            if desc:
                dbody = pdf.get(int(desc.group(1)))
                ff = re.search(rb"/FontFile2\s+(\d+)\s+\d+\s+R", dbody)
                if ff:
                    ttf = pdf.streams.get(int(ff.group(1)))
                    if ttf:
                        mapping = {
                            gid: chr(code) for gid, code in ttf_gid_to_char(ttf).items()
                        }
        out[name] = (mapping, 2 if b"/Type0" in fbody else 1, find_space_width(pdf, fbody))
    return out


def extract(path: str) -> tuple[str, int]:
    pdf = Pdf(path)
    chunks = []
    for num, body in find_pages(pdf):
        resources_raw = dict_value(body, b"Resources")
        resources = resolve_ref(pdf, resources_raw) if resources_raw is not None else body
        contents_raw = dict_value(body, b"Contents")
        contents: list[bytes] = []
        if contents_raw is not None:
            if contents_raw.startswith(b"["):
                for r in re.finditer(rb"(\d+)\s+\d+\s+R", contents_raw):
                    contents.append(pdf.streams.get(int(r.group(1)), b""))
            else:
                m = re.match(rb"\s*(\d+)\s+\d+\s+R", contents_raw)
                if m:
                    contents.append(pdf.streams.get(int(m.group(1)), b""))
        if not contents or not any(contents):
            continue
        fonts = resource_fonts(pdf, resources)
        items: list[tuple[float, float, str, float, float]] = []
        for c in contents:
            items.extend(text_items(c, fonts))
        # Drop rotated runs (the manuals stamp a rotated copyright watermark on
        # every page; mixing it into the body text wrecks both readability and
        # any signature parsing).
        items = [it for it in items if it[4] < 0.05 and it[2].strip()]
        if not items:
            continue
        items.sort(key=lambda it: (-round(it[1], 1), it[0]))
        lines: list[str] = []
        cur_y: float | None = None
        cur: list[tuple[float, str, float]] = []

        def emit_line() -> None:
            if not cur:
                return
            parts = []
            prev_end: float | None = None
            for ix, text, size in cur:
                if prev_end is not None and ix - prev_end > GAP_FACTOR * size and not text.startswith(" "):
                    parts.append(" ")
                parts.append(text)
                prev_end = ix + sum(
                    1.0 if ch not in "iljI.,;:'|!()-" else 0.45 for ch in text
                ) * 0.5 * size
            joined = "".join(parts).replace("\ufffd", "")
            # A handful of glyphs in the 3.15.4 PDF decode to C0 control codes
            # (the font's cmap maps them there). They are invisible, but they make
            # the file look binary to text tools — including the `read` tool — so
            # they are dropped here. Dropping them never changes the line count.
            joined = CONTROL_RE.sub("", joined)
            if joined.strip():
                lines.append(joined.rstrip())

        for ix, iy, text, size, _skew in items:
            if cur_y is None or abs(iy - cur_y) > 1.5:
                emit_line()
                cur = [(ix, text, size)]
                cur_y = iy
            else:
                cur.append((ix, text, size))
        emit_line()
        chunk = "\n".join(lines)
        if chunk.strip():
            chunks.append(chunk)
    return "\n\f\n".join(chunks), len(chunks)


def main() -> int:
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "ScriptManual"
    out_dir = os.path.join(src_dir, "txt")
    os.makedirs(out_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if not name.lower().endswith(".pdf"):
            continue
        path = os.path.join(src_dir, name)
        text, npages = extract(path)
        out = os.path.join(out_dir, os.path.splitext(name)[0] + ".txt")
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"{name}: {npages} pages, {len(text)} chars -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
