#!/usr/bin/env python3
"""Minimal btsnoop -> HCI ACL -> L2CAP -> ATT parser, stdlib only.

Extracts GATT handle->UUID mappings (from discovery responses) and all
ATT Write Command/Request + Handle Value Notification/Indication packets,
so we can reverse-engineer the Carrera Hybrid BLE control protocol from a
real Android "Bluetooth HCI snoop log" capture.
"""
import sys
import struct
from datetime import datetime, timezone

BTSNOOP_EPOCH_OFFSET_USEC = 0x00E03AB44A676000

ATT_OPCODE_NAMES = {
    0x01: "ErrorResponse",
    0x02: "ExchangeMTURequest",
    0x03: "ExchangeMTUResponse",
    0x04: "FindInformationRequest",
    0x05: "FindInformationResponse",
    0x06: "FindByTypeValueRequest",
    0x07: "FindByTypeValueResponse",
    0x08: "ReadByTypeRequest",
    0x09: "ReadByTypeResponse",
    0x0A: "ReadRequest",
    0x0B: "ReadResponse",
    0x0C: "ReadBlobRequest",
    0x0D: "ReadBlobResponse",
    0x10: "ReadByGroupTypeRequest",
    0x11: "ReadByGroupTypeResponse",
    0x12: "WriteRequest",
    0x13: "WriteResponse",
    0x16: "PrepareWriteRequest",
    0x17: "PrepareWriteResponse",
    0x18: "ExecuteWriteRequest",
    0x19: "ExecuteWriteResponse",
    0x1B: "HandleValueNotification",
    0x1D: "HandleValueIndication",
    0x1E: "HandleValueConfirmation",
    0x52: "WriteCommand",
    0xD2: "SignedWriteCommand",
}

WRITE_OPCODES = {0x12, 0x52, 0xD2}
NOTIFY_OPCODES = {0x1B, 0x1D}


def uuid_from_bytes(b):
    if len(b) == 2:
        return "%04x" % struct.unpack("<H", b)[0]
    if len(b) == 16:
        # little-endian 128-bit UUID
        rev = b[::-1]
        return "%08x-%04x-%04x-%04x-%012x" % (
            struct.unpack(">I", rev[0:4])[0],
            struct.unpack(">H", rev[4:6])[0],
            struct.unpack(">H", rev[6:8])[0],
            struct.unpack(">H", rev[8:10])[0],
            int.from_bytes(rev[10:16], "big"),
        )
    return b.hex()


def parse_btsnoop(path):
    with open(path, "rb") as f:
        data = f.read()

    if data[0:8] != b"btsnoop\x00":
        raise ValueError("Not a btsnoop file (bad magic)")
    version, datalink = struct.unpack(">II", data[8:16])
    pos = 16
    records = []
    n = len(data)
    while pos + 24 <= n:
        orig_len, incl_len, flags, drops, ts_raw = struct.unpack(">IIIIQ", data[pos:pos + 24])
        pos += 24
        pkt = data[pos:pos + incl_len]
        pos += incl_len
        ts_unix_usec = ts_raw - BTSNOOP_EPOCH_OFFSET_USEC
        records.append((ts_unix_usec, flags, pkt))
    return records


def parse_acl_stream(records):
    """Yield (timestamp_usec, direction, cid, att_pdu_bytes) for each complete ATT PDU on CID 0x0004."""
    # reassembly buffers keyed by (direction, handle)
    bufs = {}
    for ts, flags, pkt in records:
        if not pkt:
            continue
        h4_type = pkt[0]
        if h4_type != 0x02:  # only ACL Data packets carry L2CAP/ATT
            continue
        body = pkt[1:]
        if len(body) < 4:
            continue
        handle_flags, data_total_len = struct.unpack("<HH", body[0:4])
        conn_handle = handle_flags & 0x0FFF
        pb = (handle_flags >> 12) & 0x3
        acl_payload = body[4:4 + data_total_len]
        direction = flags & 0x01  # 0 = sent (host->controller), 1 = received (controller->host)
        key = (direction, conn_handle)

        if pb in (0x00, 0x02):  # start of a new L2CAP PDU
            if len(acl_payload) < 4:
                bufs[key] = None
                continue
            l2cap_len, cid = struct.unpack("<HH", acl_payload[0:4])
            l2cap_payload = acl_payload[4:]
            bufs[key] = {"cid": cid, "want": l2cap_len, "have": bytearray(l2cap_payload), "ts": ts, "direction": direction}
        elif pb == 0x01:  # continuation fragment
            buf = bufs.get(key)
            if buf is None:
                continue
            buf["have"].extend(acl_payload)
        else:
            continue

        buf = bufs.get(key)
        if buf is not None and len(buf["have"]) >= buf["want"]:
            yield (buf["ts"], buf["direction"], buf["cid"], bytes(buf["have"][:buf["want"]]))
            bufs[key] = None


def main():
    if len(sys.argv) < 2:
        print("Usage: parse_btsnoop.py <btsnoop_file> [--all]")
        sys.exit(1)
    path = sys.argv[1]
    show_all = "--all" in sys.argv

    records = parse_btsnoop(path)
    print(f"# {len(records)} HCI records parsed from {path}")

    handle_uuid_map = {}
    events = []

    for ts, direction, cid, pdu in parse_acl_stream(records):
        if cid != 0x0004 or not pdu:
            continue
        opcode = pdu[0]
        opname = ATT_OPCODE_NAMES.get(opcode, "0x%02x" % opcode)
        dirlabel = "PHONE->CAR" if direction == 0 else "CAR->PHONE"

        # GATT discovery: characteristic declarations (Read By Type Response for 0x2803)
        if opcode == 0x09 and len(pdu) >= 2:
            item_len = pdu[1]
            body = pdu[2:]
            for i in range(0, len(body) - item_len + 1, item_len):
                item = body[i:i + item_len]
                if len(item) < 5:
                    continue
                decl_handle = struct.unpack("<H", item[0:2])[0]
                props = item[2]
                value_handle = struct.unpack("<H", item[3:5])[0]
                uuid_bytes = item[5:]
                if uuid_bytes:
                    u = uuid_from_bytes(uuid_bytes)
                    handle_uuid_map[value_handle] = u
                    events.append((ts, dirlabel, "CharDecl", f"decl_handle=0x{decl_handle:04x} value_handle=0x{value_handle:04x} props=0x{props:02x} uuid={u}"))

        elif opcode in WRITE_OPCODES and len(pdu) >= 3:
            att_handle = struct.unpack("<H", pdu[1:3])[0]
            value = pdu[3:]
            u = handle_uuid_map.get(att_handle, "?")
            events.append((ts, dirlabel, opname, f"handle=0x{att_handle:04x} uuid={u} value={value.hex()} len={len(value)}"))

        elif opcode in NOTIFY_OPCODES and len(pdu) >= 3:
            att_handle = struct.unpack("<H", pdu[1:3])[0]
            value = pdu[3:]
            u = handle_uuid_map.get(att_handle, "?")
            events.append((ts, dirlabel, opname, f"handle=0x{att_handle:04x} uuid={u} value={value.hex()} len={len(value)}"))

        elif show_all:
            events.append((ts, dirlabel, opname, pdu[1:].hex()))

    print(f"\n# Discovered handle -> UUID map ({len(handle_uuid_map)} entries):")
    for h, u in sorted(handle_uuid_map.items()):
        print(f"  0x{h:04x} = {u}")

    print(f"\n# {len(events)} relevant ATT events (chronological):")
    t0 = events[0][0] if events else 0
    for ts, dirlabel, opname, detail in events:
        rel_ms = (ts - t0) / 1000.0
        print(f"[{rel_ms:9.1f}ms] {dirlabel:10s} {opname:22s} {detail}")


if __name__ == "__main__":
    main()
