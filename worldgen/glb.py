"""Minimal glTF 2.0 binary writer: one node + one primitive per mesh.

Attributes: POSITION, NORMAL, TEXCOORD_0, COLOR_0 (normalized u8), uint32 indices.
"""

import json
import struct

import numpy as np

FLOAT, UBYTE, UINT = 5126, 5121, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


def write_glb(path, meshes):
    """meshes: list of (name, dict(pos, nrm, uv, col, idx)) with numpy arrays."""
    blob = bytearray()
    views, accessors, gl_meshes, nodes = [], [], [], []

    def add(arr, ctype, gtype, target, normalized=False, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        data = arr.tobytes()
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        acc = {"bufferView": len(views) - 1, "componentType": ctype, "count": len(arr), "type": gtype}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    for name, m in meshes:
        if len(m["idx"]) == 0:
            continue
        attrs = {
            "POSITION": add(m["pos"].astype(np.float32), FLOAT, "VEC3", ARRAY_BUFFER, minmax=True),
            "NORMAL": add(m["nrm"].astype(np.float32), FLOAT, "VEC3", ARRAY_BUFFER),
            "TEXCOORD_0": add(m["uv"].astype(np.float32), FLOAT, "VEC2", ARRAY_BUFFER),
            "COLOR_0": add(np.clip(m["col"] * 255 + 0.5, 0, 255).astype(np.uint8), UBYTE, "VEC4",
                           ARRAY_BUFFER, normalized=True),
        }
        idx = add(m["idx"].astype(np.uint32).reshape(-1), UINT, "SCALAR", ELEMENT_ARRAY_BUFFER)
        gl_meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": idx, "mode": 4}]})
        nodes.append({"name": name, "mesh": len(gl_meshes) - 1})

    while len(blob) % 4:
        blob.append(0)
    doc = {
        "asset": {"version": "2.0", "generator": "sf-street-racer worldgen"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gl_meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942))
        f.write(blob)
