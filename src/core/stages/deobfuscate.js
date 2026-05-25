// src/core/stages/deobfuscate.js
import path from "node:path/posix";
import { Buffer } from "node:buffer";
import { parseContainer, parseOpf, patchOpfManifest, serializeOpf } from "../opf.js";
import { patchXhtml, patchNcx, patchCss } from "../patchers.js";

export function deobfuscate(buf, _ctx) {
  const containerXml = buf.entries["META-INF/container.xml"].toString("utf-8");
  const opfPath = parseContainer(containerXml);
  const opfDir = path.dirname(opfPath);
  const opfText = buf.entries[opfPath].toString("utf-8");
  const { tree, pkg, mapping } = parseOpf(opfText);

  patchOpfManifest(pkg, mapping);

  const newNames = [];
  const newEntries = {};
  for (const name of buf.names) {
    const data = buf.entries[name];
    const ext = path.extname(name).toLowerCase();

    let rel = null;
    if (opfDir && opfDir !== "." && name.startsWith(opfDir + "/")) {
      rel = name.slice(opfDir.length + 1);
    } else if (!opfDir || opfDir === ".") {
      rel = name;
    }

    let newName = name;
    if (rel !== null && mapping[rel]) {
      newName = opfDir && opfDir !== "." ? `${opfDir}/${mapping[rel]}` : mapping[rel];
    }

    let newData;
    if (ext === ".opf") {
      // 留给 heal/align 进一步改 metadata；此处先序列化 manifest 改完的状态
      newData = Buffer.from(serializeOpf(tree), "utf-8");
    } else if (ext === ".xhtml" || ext === ".html") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchXhtml(data.toString("utf-8"), mapping, base === "." ? "" : base),
        "utf-8",
      );
    } else if (ext === ".ncx") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchNcx(data.toString("utf-8"), mapping, base === "." ? "" : base),
        "utf-8",
      );
    } else if (ext === ".css") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchCss(data.toString("utf-8"), mapping, base || "Styles"),
        "utf-8",
      );
    } else {
      newData = data;
    }
    newNames.push(newName);
    newEntries[newName] = newData;
  }

  // 在 meta 里挂出 opf 信息，避免 heal/align 重复解析
  return {
    names: newNames,
    entries: newEntries,
    meta: { opfPath, opfDir, opfTree: tree, mapping },
  };
}
