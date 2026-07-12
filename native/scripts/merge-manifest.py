#!/usr/bin/env python3
"""Merge AndroidManifest.additions.xml into the Capacitor-generated manifest.
Idempotent: skips nodes already present. Adds extractNativeLibs to <application>.
"""
import sys, re
import xml.etree.ElementTree as ET

ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)

def a(name): return f"{{{ANDROID}}}{name}"

main_path, add_path = sys.argv[1], sys.argv[2]
main = ET.parse(main_path); root = main.getroot()
add  = ET.parse(add_path).getroot()

app = root.find("application")
app.set(a("extractNativeLibs"), "true")

existing_perms = {p.get(a("name")) for p in root.findall("uses-permission")}
for node in add:
    if node.tag == "uses-permission":
        if node.get(a("name")) not in existing_perms:
            root.insert(0, node)
    elif node.tag == "service":
        name = node.get(a("name"))
        if not any(s.get(a("name")) == name for s in app.findall("service")):
            app.append(node)

main.write(main_path, encoding="utf-8", xml_declaration=True)
print(f"merged {add_path} -> {main_path}")
